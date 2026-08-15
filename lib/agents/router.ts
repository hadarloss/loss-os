import OpenAI from "openai";
import { getAnthropicClient, DEFAULT_MODEL, MAX_TOKENS } from "@/lib/anthropic/client";
import { getOpenAIClient, DEFAULT_OPENAI_MODEL, OPENAI_MAX_TOKENS } from "@/lib/openai/client";
import {
  getOmniRouteClient,
  DEFAULT_OMNIROUTE_MODEL,
  OMNIROUTE_MAX_TOKENS,
} from "@/lib/omniroute/client";
import { AgentDef, ConversationMessage } from "@/lib/agents/types";

export type { ConversationMessage };

export interface RoutingDecision {
  agentId: string;
  reason: string;
  deliverableType: string;
  brief?: string;
}

/** Business profile + memory log, appended to every agent's persona so it answers with real context. */
export function buildContextBlock(businessProfile: string, memoryLog: string): string {
  return [
    "\n\n---\n",
    "## תיק העסק (context/BUSINESS_PROFILE.md)\n",
    businessProfile.trim() || "_(עדיין לא הוגדר תיק עסק — הציעו למשתמש לעבור אונבורדינג עם אוריתה)_",
    "\n\n## יומן זיכרון דינאמי — כללים והעדפות שנצברו (context/MEMORY_LOG.md)\n",
    memoryLog.trim() || "_(אין עדיין רשומות)_",
  ].join("\n");
}

export function buildAgentSystemPrompt(
  agent: AgentDef,
  businessProfile: string,
  memoryLog: string,
  routingBrief?: string
): string {
  const briefBlock = routingBrief?.trim()
    ? `\n\n## דגשים מחייבים מהניתוב (מהמנהל/ת שהפנה/תה אליך)\n${routingBrief.trim()}`
    : "";
  return agent.systemPrompt + buildContextBlock(businessProfile, memoryLog) + briefBlock;
}

function buildRosterText(specialists: AgentDef[]): string {
  return specialists
    .map((s) => `- ${s.id} — ${s.icon} ${s.name} (${s.role}): ${s.description}`)
    .join("\n");
}

const ROUTE_TOOL_NAME = "route_to_agent";
const ROUTE_TOOL_DESCRIPTION = "בחר/י את הסוכן המומחה המתאים ביותר לטיפול בבקשה הנוכחית.";

interface RouteToolInput {
  agent_id: string;
  reason: string;
  deliverable_type?: string;
  brief?: string;
}

function buildRouteToolSchema(specialistIds: string[]) {
  return {
    type: "object" as const,
    properties: {
      agent_id: {
        type: "string",
        enum: specialistIds,
        description: "המזהה (id) המדויק של הסוכן שנבחר",
      },
      reason: {
        type: "string",
        description: "הסבר קצר למה נבחר סוכן זה",
      },
      deliverable_type: {
        type: "string",
        description: "סוג התוצר הצפוי מהניתוב הזה, לדוגמה: social_post, funnel_plan",
      },
      brief: {
        type: "string",
        description:
          "דגשים או אילוצים מחייבים מתוך הידע שלך כמנהל/ת (למשל כללי מותג, מגבלות שכבר נקבעו) שהמומחה/ית שנבחר/ה " +
          "חייב/ת לדעת כדי לא להפר אותם — המומחה/ית לא רואה את הפרומפט שלך, רק את מה שתכתוב/י כאן. השאר/י ריק אם אין דגש מיוחד.",
      },
    },
    required: ["agent_id", "reason"],
  };
}

function toRoutingDecision(input: RouteToolInput, specialistIds: string[]): RoutingDecision {
  if (!specialistIds.includes(input.agent_id)) {
    throw new Error(`המנהל ניתב לסוכן לא קיים: ${input.agent_id}`);
  }
  return {
    agentId: input.agent_id,
    reason: input.reason,
    deliverableType: input.deliverable_type ?? "general",
    brief: input.brief,
  };
}

/**
 * Asks the team lead to pick which specialist should handle a new request,
 * using forced tool-use for a reliable, non-hallucinated agent id.
 */
async function routeToAgentAnthropic(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string
): Promise<RoutingDecision> {
  const client = getAnthropicClient();

  const systemPrompt =
    lead.systemPrompt +
    "\n\n---\n\n## רשימת הסוכנים בצוות שלך (לצורך ניתוב בלבד — אלה המזהים היחידים התקפים)\n" +
    buildRosterText(specialists) +
    buildContextBlock(businessProfile, memoryLog);

  const specialistIds = specialists.map((s) => s.id);

  const response = await client.messages.create({
    model: lead.model || DEFAULT_MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    tools: [
      {
        name: ROUTE_TOOL_NAME,
        description: ROUTE_TOOL_DESCRIPTION,
        input_schema: buildRouteToolSchema(specialistIds),
      },
    ],
    tool_choice: { type: "tool", name: ROUTE_TOOL_NAME },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("המנהל לא החזיר החלטת ניתוב תקינה.");
  }

  return toRoutingDecision(toolUse.input as RouteToolInput, specialistIds);
}

/** OpenAI Responses API equivalent of routeToAgentAnthropic — forced function call. */
async function routeToAgentOpenAI(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string
): Promise<RoutingDecision> {
  const client = getOpenAIClient();

  const systemPrompt =
    lead.systemPrompt +
    "\n\n---\n\n## רשימת הסוכנים בצוות שלך (לצורך ניתוב בלבד — אלה המזהים היחידים התקפים)\n" +
    buildRosterText(specialists) +
    buildContextBlock(businessProfile, memoryLog);

  const specialistIds = specialists.map((s) => s.id);

  const response = await client.responses.create({
    model: lead.model || DEFAULT_OPENAI_MODEL,
    instructions: systemPrompt,
    input: toOpenAIInput(history),
    tools: [
      {
        type: "function",
        name: ROUTE_TOOL_NAME,
        description: ROUTE_TOOL_DESCRIPTION,
        parameters: buildRouteToolSchema(specialistIds),
        strict: false,
      },
    ],
    tool_choice: { type: "function", name: ROUTE_TOOL_NAME },
  });

  const call = response.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
  );
  if (!call) {
    throw new Error("המנהל לא החזיר החלטת ניתוב תקינה.");
  }

  let input: RouteToolInput;
  try {
    input = JSON.parse(call.arguments) as RouteToolInput;
  } catch {
    throw new Error("המנהל החזיר ניתוב שלא ניתן לפרש (JSON שגוי).");
  }

  return toRoutingDecision(input, specialistIds);
}

/**
 * OmniRoute is an OpenAI-compatible gateway, but only its Chat Completions endpoint
 * (`/v1/chat/completions`) is confirmed across the providers it fronts — unlike direct
 * OpenAI above, this does not use the newer Responses API.
 */
function toChatCompletionMessages(
  systemPrompt: string,
  history: ConversationMessage[]
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const systemMessage: OpenAI.Chat.Completions.ChatCompletionSystemMessageParam = {
    role: "system",
    content: systemPrompt,
  };

  const turns: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = history.map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    if (m.role === "assistant") {
      // Our assistant turns are always plain text — Chat Completions assistant
      // content doesn't carry image/file parts the way user content does.
      const text = m.content.map((block) => (block.type === "text" ? block.text : "")).join("\n");
      return { role: "assistant", content: text };
    }
    return {
      role: "user",
      content: m.content.map((block): OpenAI.Chat.Completions.ChatCompletionContentPart => {
        if (block.type === "text") {
          return { type: "text", text: block.text };
        }
        if (block.type === "image") {
          return {
            type: "image_url",
            image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
          };
        }
        return {
          type: "file",
          file: {
            filename: block.title ?? "document.pdf",
            file_data: `data:application/pdf;base64,${block.source.data}`,
          },
        };
      }),
    };
  });

  return [systemMessage, ...turns];
}

/** OmniRoute equivalent of routeToAgentAnthropic — forced function call over Chat Completions. */
async function routeToAgentOmniRoute(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string
): Promise<RoutingDecision> {
  const client = getOmniRouteClient();

  const systemPrompt =
    lead.systemPrompt +
    "\n\n---\n\n## רשימת הסוכנים בצוות שלך (לצורך ניתוב בלבד — אלה המזהים היחידים התקפים)\n" +
    buildRosterText(specialists) +
    buildContextBlock(businessProfile, memoryLog);

  const specialistIds = specialists.map((s) => s.id);

  const response = await client.chat.completions.create({
    model: lead.model || DEFAULT_OMNIROUTE_MODEL,
    messages: toChatCompletionMessages(systemPrompt, history),
    tools: [
      {
        type: "function",
        function: {
          name: ROUTE_TOOL_NAME,
          description: ROUTE_TOOL_DESCRIPTION,
          parameters: buildRouteToolSchema(specialistIds),
        },
      },
    ],
    tool_choice: { type: "function", function: { name: ROUTE_TOOL_NAME } },
  });

  const call = response.choices[0]?.message.tool_calls?.find(
    (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall =>
      tc.type === "function"
  );
  if (!call) {
    throw new Error("המנהל לא החזיר החלטת ניתוב תקינה.");
  }

  let input: RouteToolInput;
  try {
    input = JSON.parse(call.function.arguments) as RouteToolInput;
  } catch {
    throw new Error("המנהל החזיר ניתוב שלא ניתן לפרש (JSON שגוי).");
  }

  return toRoutingDecision(input, specialistIds);
}

/** Routes to the Anthropic, OpenAI, or OmniRoute implementation based on the lead agent's `provider`. */
export async function routeToAgent(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string
): Promise<RoutingDecision> {
  if (lead.provider === "openai") {
    return routeToAgentOpenAI(lead, specialists, history, businessProfile, memoryLog);
  }
  if (lead.provider === "omniroute") {
    return routeToAgentOmniRoute(lead, specialists, history, businessProfile, memoryLog);
  }
  return routeToAgentAnthropic(lead, specialists, history, businessProfile, memoryLog);
}

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

/** Converts our provider-agnostic conversation history into OpenAI Responses API input items. */
function toOpenAIInput(history: ConversationMessage[]): OpenAI.Responses.ResponseInputItem[] {
  return history.map((m) => ({
    role: m.role,
    content:
      typeof m.content === "string"
        ? m.content
        : m.content.map((block): OpenAI.Responses.ResponseInputContent => {
            if (block.type === "text") {
              return { type: "input_text", text: block.text };
            }
            if (block.type === "image") {
              return {
                type: "input_image",
                detail: "auto",
                image_url: `data:${block.source.media_type};base64,${block.source.data}`,
              };
            }
            return {
              type: "input_file",
              filename: block.title ?? "document.pdf",
              file_data: `data:application/pdf;base64,${block.source.data}`,
            };
          }),
  }));
}

/** Streams a single agent's reply using its persona as the system prompt (Claude). */
async function streamAgentReplyAnthropic(
  agent: AgentDef,
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string,
  callbacks: StreamCallbacks,
  routingBrief?: string
): Promise<void> {
  const client = getAnthropicClient();
  const systemPrompt = buildAgentSystemPrompt(agent, businessProfile, memoryLog, routingBrief);

  const stream = client.messages.stream({
    model: agent.model || DEFAULT_MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
  });

  stream.on("text", (delta) => callbacks.onText(delta));

  try {
    const finalText = await stream.finalText();
    callbacks.onDone(finalText);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Streams a single agent's reply using its persona as the system prompt (OpenAI Responses API). */
async function streamAgentReplyOpenAI(
  agent: AgentDef,
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string,
  callbacks: StreamCallbacks,
  routingBrief?: string
): Promise<void> {
  const client = getOpenAIClient();
  const systemPrompt = buildAgentSystemPrompt(agent, businessProfile, memoryLog, routingBrief);

  try {
    const stream = await client.responses.create({
      model: agent.model || DEFAULT_OPENAI_MODEL,
      instructions: systemPrompt,
      input: toOpenAIInput(history),
      max_output_tokens: OPENAI_MAX_TOKENS,
      stream: true,
    });

    let fullText = "";
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        fullText += event.delta;
        callbacks.onText(event.delta);
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "OpenAI response failed");
      } else if (event.type === "error") {
        throw new Error(event.message);
      }
    }

    callbacks.onDone(fullText);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Streams a single agent's reply using its persona as the system prompt (OmniRoute / Chat Completions). */
async function streamAgentReplyOmniRoute(
  agent: AgentDef,
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string,
  callbacks: StreamCallbacks,
  routingBrief?: string
): Promise<void> {
  const client = getOmniRouteClient();
  const systemPrompt = buildAgentSystemPrompt(agent, businessProfile, memoryLog, routingBrief);

  try {
    const stream = await client.chat.completions.create({
      model: agent.model || DEFAULT_OMNIROUTE_MODEL,
      messages: toChatCompletionMessages(systemPrompt, history),
      max_tokens: OMNIROUTE_MAX_TOKENS,
      stream: true,
    });

    let fullText = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        callbacks.onText(delta);
      }
    }

    callbacks.onDone(fullText);
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

/** Streams the agent's reply from Anthropic, OpenAI, or OmniRoute based on the agent's `provider`. */
export async function streamAgentReply(
  agent: AgentDef,
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string,
  callbacks: StreamCallbacks,
  routingBrief?: string
): Promise<void> {
  if (agent.provider === "openai") {
    return streamAgentReplyOpenAI(agent, history, businessProfile, memoryLog, callbacks, routingBrief);
  }
  if (agent.provider === "omniroute") {
    return streamAgentReplyOmniRoute(agent, history, businessProfile, memoryLog, callbacks, routingBrief);
  }
  return streamAgentReplyAnthropic(agent, history, businessProfile, memoryLog, callbacks, routingBrief);
}
