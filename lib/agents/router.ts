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

/**
 * System prompt for a ROUTING call only — deliberately excludes buildContextBlock (full business
 * profile + full memory log). Routing just needs the roster to pick an agent_id; the specialist's
 * own reply (buildAgentSystemPrompt) is where that context actually matters. Skipping it here keeps
 * the routing payload small regardless of how large a lead's own persona or the memory log grows —
 * a lead with a long persona (e.g. an appended brand guide) plus the full context block was blowing
 * past weaker OmniRoute fallback models' request-size limits and breaking routing entirely.
 */
// Some leads' skill files run well past this for reasons unrelated to routing (e.g.
// ray_branding_lead.md has ~150 lines of brand-guide reference material appended for her
// specialists' benefit, not hers) — full detail like that isn't needed to pick an agent_id,
// and free-tier OmniRoute fallback models reject oversized requests outright (413/400) even
// after dropping the business-profile/memory-log context block. Cap what's actually sent.
const ROUTING_PERSONA_CHAR_LIMIT = 4000;

function buildRoutingSystemPrompt(lead: AgentDef, specialists: AgentDef[]): string {
  const persona =
    lead.systemPrompt.length > ROUTING_PERSONA_CHAR_LIMIT
      ? lead.systemPrompt.slice(0, ROUTING_PERSONA_CHAR_LIMIT) +
        "\n\n_(המשך הפרסונה קוצר לצורך ניתוב בלבד — התוכן המלא זמין למומחה/ית שתבחר/י בתגובה שלו/ה.)_"
      : lead.systemPrompt;

  return (
    persona +
    "\n\n---\n\n## רשימת הסוכנים בצוות שלך (לצורך ניתוב בלבד — אלה המזהים היחידים התקפים)\n" +
    buildRosterText(specialists)
  );
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
  if (!input?.agent_id) {
    // Seen from weaker/free-tier OmniRoute fallback models garbling forced tool-use under load —
    // a clear, retryable message instead of "לא קיים: undefined".
    throw new Error("המנהל לא הצליח לבחור סוכן מתאים לבקשה. נסו לשלוח את ההודעה שוב.");
  }
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

  const systemPrompt = buildRoutingSystemPrompt(lead, specialists);

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

  const systemPrompt = buildRoutingSystemPrompt(lead, specialists);

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

  const systemPrompt = buildRoutingSystemPrompt(lead, specialists);

  const specialistIds = specialists.map((s) => s.id);

  const response = await client.chat.completions.create({
    model: lead.model || DEFAULT_OMNIROUTE_MODEL,
    messages: toChatCompletionMessages(systemPrompt, history),
    // Reasoning-capable routing models (e.g. Gemini) spend several hundred tokens thinking
    // before emitting the tool call — leaving this unset falls back to whatever low default
    // the underlying provider picks, silently truncating the response before the tool call.
    max_tokens: 2048,
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
function routeToAgentOnce(
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

/**
 * Routes to the Anthropic, OpenAI, or OmniRoute implementation based on the lead agent's
 * `provider`, retrying once on failure — OmniRoute in particular has shown intermittent
 * transient errors ("unknown provider for model X") unrelated to payload/content that a
 * simple retry reliably absorbs, rather than surfacing a one-off gateway hiccup to the user.
 */
export async function routeToAgent(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[],
  businessProfile: string,
  memoryLog: string
): Promise<RoutingDecision> {
  try {
    return await routeToAgentOnce(lead, specialists, history, businessProfile, memoryLog);
  } catch {
    return routeToAgentOnce(lead, specialists, history, businessProfile, memoryLog);
  }
}

export interface StreamCallbacks {
  onText: (delta: string) => void;
  onDone: (fullText: string, resolvedModel?: string) => void;
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
    callbacks.onDone(finalText, agent.model || DEFAULT_MODEL);
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

    callbacks.onDone(fullText, agent.model || DEFAULT_OPENAI_MODEL);
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
    // OmniRoute's combo can fall back across several real models — each chunk echoes back
    // whichever one actually answered, which is usually more specific than the combo name
    // requested (e.g. "openrouter/openai/gpt-oss-20b" instead of "archetype-d-...").
    let resolvedModel: string | undefined;
    for await (const chunk of stream) {
      if (!resolvedModel && chunk.model) resolvedModel = chunk.model;
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        callbacks.onText(delta);
      }
    }

    callbacks.onDone(fullText, resolvedModel ?? (agent.model || DEFAULT_OMNIROUTE_MODEL));
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

// --- Autonomous next-step classification (deliverable done / hand off / ask the user) ---

export type NextStepDecision =
  | { type: "deliverable_complete"; deliverableType: string }
  | { type: "handoff_needed"; agentId: string; brief: string }
  | { type: "needs_user_input" };

const NEXT_STEP_TOOL_NAME = "decide_next_step";
// Pinned model id, not the "-latest" alias — OmniRoute intermittently fails to resolve alias
// names ("unknown provider for model gemini-flash-latest") even though the underlying model is
// healthy; a concrete id like this one has tested reliably across dozens of repeated calls.
const NEXT_STEP_CLASSIFIER_MODEL = "gemini/gemini-3.1-flash-lite";

const NEXT_STEP_SYSTEM_PROMPT = [
  "את/ה מסווג/ת החלטות פנימי בצוות AI שיווקי/מיתוגי — לא פונה למשתמש ישירות.",
  "תפקידך היחיד: לקרוא את התגובה האחרונה של סוכן, ולהחליט מה השלב הבא בתהליך.",
  "",
  "שלוש אפשרויות בלבד:",
  '- deliverable_complete — הסוכן סיים תוצר סופי לבקשה (למשל: גאנט מוכן, רעיון/קופי/תוכן סופי שנמסר). זה כולל מקרה שבו הסוכן שאל שאלת חידוד בתחילת התהליך, קיבל תשובה, ואז השלים את התוצר.',
  '- handoff_needed — הבקשה המקורית עדיין לא הושלמה במלואה, וסוכן/ית אחר/ת בצוות צריכ/ה להמשיך את העבודה (למשל: תוכן נכתב אבל צריך עכשיו בדיקת עקביות מיתוגית). ציינו agent_id מדויק מתוך הרשימה, ו-brief קצר עם מה שהסוכן הבא חייב לדעת.',
  '- needs_user_input — יש שאלה אמיתית וחוסמת שרק המשתמש יכול לענות עליה (לא "איזה טון תרצה" קטן, אלא צומת החלטה אמיתי, או שהתגובה עצמה היא שאלת חידוד ראשונית לפני תחילת העבודה).',
  "",
  "בספק — בחרו needs_user_input. אין להמציא agent_id שלא ברשימה.",
].join("\n");

function buildNextStepToolSchema(specialistIds: string[]) {
  return {
    type: "object" as const,
    properties: {
      decision: {
        type: "string",
        enum: ["deliverable_complete", "handoff_needed", "needs_user_input"],
        description: "השלב הבא בתהליך",
      },
      deliverable_type: {
        type: "string",
        description: "רק אם decision=deliverable_complete: סוג התוצר, למשל gantt, social_post, brand_review",
      },
      agent_id: {
        type: "string",
        enum: specialistIds,
        description: "רק אם decision=handoff_needed: מזהה מדויק של הסוכן הבא מתוך הרשימה",
      },
      brief: {
        type: "string",
        description: "רק אם decision=handoff_needed: דגשים קצרים שהסוכן הבא חייב לדעת",
      },
    },
    required: ["decision"],
  };
}

interface NextStepToolInput {
  decision: "deliverable_complete" | "handoff_needed" | "needs_user_input";
  deliverable_type?: string;
  agent_id?: string;
  brief?: string;
}

/**
 * Runs after a specialist's reply finishes streaming — decides whether the turn is done (save
 * as a deliverable), needs another specialist to continue autonomously, or needs to stop and
 * show the user a real question. Deliberately fails safe: any error, missing tool call, or
 * unparseable response falls back to `needs_user_input`, i.e. today's behavior (show the reply,
 * do nothing automatic) — a classification hiccup should never silently drop or misroute work.
 * Only implemented for `provider: omniroute` agents (all 39 agents in this app use it); other
 * providers also fall back to `needs_user_input`.
 */
export async function classifyNextStep(
  agent: AgentDef,
  replyText: string,
  originalRequest: string,
  specialists: AgentDef[]
): Promise<NextStepDecision> {
  if (agent.provider !== "omniroute" || !replyText.trim()) {
    return { type: "needs_user_input" };
  }

  const others = specialists.filter((s) => s.id !== agent.id);
  const specialistIds = others.map((s) => s.id);

  try {
    const client = getOmniRouteClient();
    const response = await client.chat.completions.create({
      model: NEXT_STEP_CLASSIFIER_MODEL,
      messages: [
        {
          role: "system",
          content:
            NEXT_STEP_SYSTEM_PROMPT +
            "\n\n## חברי צוות זמינים להעברת עבודה (handoff_needed בלבד)\n" +
            buildRosterText(others),
        },
        {
          role: "user",
          content: `הבקשה המקורית מהמשתמש:\n${originalRequest.slice(0, 1000)}\n\nהתגובה של ${agent.name} (${agent.id}):\n${replyText.slice(0, 3000)}`,
        },
      ],
      max_tokens: 1024,
      tools: [
        {
          type: "function",
          function: {
            name: NEXT_STEP_TOOL_NAME,
            description: "קבע/י את השלב הבא בתהליך",
            parameters: buildNextStepToolSchema(specialistIds),
          },
        },
      ],
      tool_choice: { type: "function", function: { name: NEXT_STEP_TOOL_NAME } },
    });

    const call = response.choices[0]?.message.tool_calls?.find(
      (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === "function"
    );
    if (!call) return { type: "needs_user_input" };

    const input = JSON.parse(call.function.arguments) as NextStepToolInput;

    if (input.decision === "handoff_needed" && input.agent_id && specialistIds.includes(input.agent_id)) {
      return { type: "handoff_needed", agentId: input.agent_id, brief: input.brief?.trim() ?? "" };
    }
    if (input.decision === "deliverable_complete") {
      return { type: "deliverable_complete", deliverableType: input.deliverable_type?.trim() || "general" };
    }
    return { type: "needs_user_input" };
  } catch {
    return { type: "needs_user_input" };
  }
}
