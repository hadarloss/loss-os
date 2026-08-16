import OpenAI from "openai";
import { getAnthropicClient, DEFAULT_MODEL, MAX_TOKENS } from "@/lib/anthropic/client";
import { getOpenAIClient, DEFAULT_OPENAI_MODEL, OPENAI_MAX_TOKENS } from "@/lib/openai/client";
import {
  getOmniRouteClient,
  DEFAULT_OMNIROUTE_MODEL,
  OMNIROUTE_MAX_TOKENS,
} from "@/lib/omniroute/client";
import { AgentDef, ConversationMessage, PlanTask } from "@/lib/agents/types";

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

function buildRosterText(specialists: AgentDef[]): string {
  return specialists
    .map((s) => `- ${s.id} — ${s.icon} ${s.name} (${s.role}): ${s.description}`)
    .join("\n");
}

/**
 * Who's on the agent's own team and what each of them does — the same roster a lead already
 * sees when routing (`buildRosterText`), but injected into every specialist's own reply too, not
 * just the lead's routing decision. Without this, a specialist has no live knowledge of its
 * teammates unless that happened to be hand-written into its persona file, which drifts out of
 * sync the moment the roster changes. Excludes the agent itself; the lead (if present) is listed
 * first with an explicit "מנהל/ת הצוות" marker so a specialist knows who to defer routing to.
 */
function buildTeamRosterBlock(agent: AgentDef, teamRoster: AgentDef[]): string {
  const others = teamRoster.filter((a) => a.id !== agent.id);
  if (others.length === 0) return "";
  const lines = others.map((a) =>
    a.kind === "lead"
      ? `- ${a.id} — ${a.icon} ${a.name} (מנהל/ת הצוות — ${a.role}): ${a.description}`
      : `- ${a.id} — ${a.icon} ${a.name} (${a.role}): ${a.description}`
  );
  return `\n\n## הצוות שלך\nחברי/ות הצוות שאת/ה עובד/ת איתם, ומה כל אחד/ת מהם עושה — לידיעה כשמשהו חורג מהתחום שלך ושווה לציין שכדאי להעביר הלאה:\n${lines.join("\n")}`;
}

export function buildAgentSystemPrompt(
  agent: AgentDef,
  businessProfile: string,
  memoryLog: string,
  routingBrief?: string,
  teamRoster?: AgentDef[]
): string {
  const briefBlock = routingBrief?.trim()
    ? `\n\n## דגשים מחייבים מהניתוב (מהמנהל/ת שהפנה/תה אליך)\n${routingBrief.trim()}`
    : "";
  const rosterBlock = teamRoster?.length ? buildTeamRosterBlock(agent, teamRoster) : "";
  return agent.systemPrompt + buildContextBlock(businessProfile, memoryLog) + rosterBlock + briefBlock;
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

// --- Plan proposal (a lead breaks a request into one or more ordered specialist tasks) ---

export interface ProposedTask {
  agentId: string;
  deliverableType: string;
  title: string;
  brief: string;
  /** 0-based indices into the same tasks array — resolved to real task ids by the caller. */
  dependsOnIndex: number[];
}

export interface ProposedPlan {
  goal: string;
  tasks: ProposedTask[];
}

const PROPOSE_PLAN_TOOL_NAME = "propose_plan";
const PROPOSE_PLAN_TOOL_DESCRIPTION =
  "קבע/י את תוכנית העבודה לבקשה הנוכחית: משימה בודדת אחת (ברירת המחדל לרוב הבקשות) או רצף משימות מרובה-סוכנים כשבאמת נדרש.";
const MAX_PLAN_TASKS = 8;

interface ProposePlanToolInput {
  goal?: string;
  tasks?: {
    agent_id: string;
    deliverable_type?: string;
    title?: string;
    brief?: string;
    depends_on_index?: number[];
  }[];
}

function buildProposePlanToolSchema(specialistIds: string[]) {
  return {
    type: "object" as const,
    properties: {
      goal: {
        type: "string",
        description: "ניסוח קצר של מה שהמשתמש מבקש בפועל — יוצג למשתמש ככותרת התוכנית.",
      },
      tasks: {
        type: "array",
        minItems: 1,
        maxItems: MAX_PLAN_TASKS,
        items: {
          type: "object",
          properties: {
            agent_id: {
              type: "string",
              enum: specialistIds,
              description: "מזהה מדויק של הסוכן/ית האחראי/ת למשימה",
            },
            deliverable_type: {
              type: "string",
              description: "סוג התוצר הצפוי, לדוגמה: social_post, funnel_plan",
            },
            title: { type: "string", description: "כותרת קצרה וברורה למשימה (עד 80 תווים)" },
            brief: {
              type: "string",
              description: "מה בדיוק הסוכן/ית הזה/ו צריכ/ה לעשות במשימה הזו",
            },
            depends_on_index: {
              type: "array",
              items: { type: "number" },
              description:
                "אינדקסים (0-based) של משימות אחרות במערך שחייבות להסתיים לפני שהמשימה הזו מתחילה. השאר/י ריק אם אין תלות.",
            },
          },
          required: ["agent_id", "deliverable_type", "title", "brief"],
        },
        description:
          "רשימת המשימות לפי סדר ביצוע. אם הבקשה דורשת רק סוכן/ית אחד/ת (המקרה השכיח ביותר) — החזר/י מערך " +
          "באורך 1 בדיוק. השתמש/י ביותר ממשימה אחת רק כשבאמת נדרש רצף עבודה של כמה סוכנים שונים בזה אחר זה " +
          "(למשל: מחקר → כתיבת קופי → בדיקת עקביות מיתוגית). אל תפצל בקשה פשוטה למשימות מלאכותיות.",
      },
    },
    required: ["goal", "tasks"],
  };
}

function toProposedPlan(input: ProposePlanToolInput, specialistIds: string[]): ProposedPlan {
  if (!input?.tasks?.length) {
    throw new Error("המנהל לא החזיר תוכנית תקינה.");
  }
  const rawTasks = input.tasks.slice(0, MAX_PLAN_TASKS);
  for (const t of rawTasks) {
    if (!t.agent_id || !specialistIds.includes(t.agent_id)) {
      throw new Error(`המנהל שיבץ משימה לסוכן לא קיים: ${t.agent_id}`);
    }
  }
  return {
    goal: input.goal?.trim() || "עבודה חדשה",
    tasks: rawTasks.map((t) => ({
      agentId: t.agent_id,
      deliverableType: t.deliverable_type?.trim() || "general",
      title: t.title?.trim().slice(0, 80) || "משימה",
      brief: t.brief?.trim() || "",
      dependsOnIndex: (t.depends_on_index ?? []).filter(
        (i) => typeof i === "number" && i >= 0 && i < rawTasks.length
      ),
    })),
  };
}

async function proposePlanAnthropic(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[]
): Promise<ProposedPlan> {
  const client = getAnthropicClient();
  const systemPrompt = buildRoutingSystemPrompt(lead, specialists);
  const specialistIds = specialists.map((s) => s.id);

  const response = await client.messages.create({
    model: lead.model || DEFAULT_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    tools: [
      {
        name: PROPOSE_PLAN_TOOL_NAME,
        description: PROPOSE_PLAN_TOOL_DESCRIPTION,
        input_schema: buildProposePlanToolSchema(specialistIds),
      },
    ],
    tool_choice: { type: "tool", name: PROPOSE_PLAN_TOOL_NAME },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("המנהל לא החזיר תוכנית תקינה.");
  }
  return toProposedPlan(toolUse.input as ProposePlanToolInput, specialistIds);
}

async function proposePlanOpenAI(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[]
): Promise<ProposedPlan> {
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
        name: PROPOSE_PLAN_TOOL_NAME,
        description: PROPOSE_PLAN_TOOL_DESCRIPTION,
        parameters: buildProposePlanToolSchema(specialistIds),
        strict: false,
      },
    ],
    tool_choice: { type: "function", name: PROPOSE_PLAN_TOOL_NAME },
  });

  const call = response.output.find(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
  );
  if (!call) {
    throw new Error("המנהל לא החזיר תוכנית תקינה.");
  }

  let input: ProposePlanToolInput;
  try {
    input = JSON.parse(call.arguments) as ProposePlanToolInput;
  } catch {
    throw new Error("המנהל החזיר תוכנית שלא ניתן לפרש (JSON שגוי).");
  }
  return toProposedPlan(input, specialistIds);
}

async function proposePlanOmniRoute(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[]
): Promise<ProposedPlan> {
  const client = getOmniRouteClient();
  const systemPrompt = buildRoutingSystemPrompt(lead, specialists);
  const specialistIds = specialists.map((s) => s.id);

  const response = await client.chat.completions.create({
    model: lead.model || DEFAULT_OMNIROUTE_MODEL,
    messages: toChatCompletionMessages(systemPrompt, history),
    max_tokens: 2048,
    tools: [
      {
        type: "function",
        function: {
          name: PROPOSE_PLAN_TOOL_NAME,
          description: PROPOSE_PLAN_TOOL_DESCRIPTION,
          parameters: buildProposePlanToolSchema(specialistIds),
        },
      },
    ],
    tool_choice: { type: "function", function: { name: PROPOSE_PLAN_TOOL_NAME } },
  });

  const call = response.choices[0]?.message.tool_calls?.find(
    (tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === "function"
  );
  if (!call) {
    throw new Error("המנהל לא החזיר תוכנית תקינה.");
  }

  let input: ProposePlanToolInput;
  try {
    input = JSON.parse(call.function.arguments) as ProposePlanToolInput;
  } catch {
    throw new Error("המנהל החזיר תוכנית שלא ניתן לפרש (JSON שגוי).");
  }
  return toProposedPlan(input, specialistIds);
}

function proposePlanOnce(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[]
): Promise<ProposedPlan> {
  if (lead.provider === "openai") return proposePlanOpenAI(lead, specialists, history);
  if (lead.provider === "omniroute") return proposePlanOmniRoute(lead, specialists, history);
  return proposePlanAnthropic(lead, specialists, history);
}

/** Asks the team lead to break the current request into one or more ordered specialist tasks —
 *  same retry-once behavior as routeToAgent, for the same transient-gateway-error reasons. */
export async function proposePlan(
  lead: AgentDef,
  specialists: AgentDef[],
  history: ConversationMessage[]
): Promise<ProposedPlan> {
  try {
    return await proposePlanOnce(lead, specialists, history);
  } catch {
    return proposePlanOnce(lead, specialists, history);
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
  routingBrief?: string,
  teamRoster?: AgentDef[]
): Promise<void> {
  const client = getAnthropicClient();
  const systemPrompt = buildAgentSystemPrompt(agent, businessProfile, memoryLog, routingBrief, teamRoster);

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
  routingBrief?: string,
  teamRoster?: AgentDef[]
): Promise<void> {
  const client = getOpenAIClient();
  const systemPrompt = buildAgentSystemPrompt(agent, businessProfile, memoryLog, routingBrief, teamRoster);

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
  routingBrief?: string,
  teamRoster?: AgentDef[]
): Promise<void> {
  const client = getOmniRouteClient();
  const systemPrompt = buildAgentSystemPrompt(agent, businessProfile, memoryLog, routingBrief, teamRoster);

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
  routingBrief?: string,
  teamRoster?: AgentDef[]
): Promise<void> {
  if (agent.provider === "openai") {
    return streamAgentReplyOpenAI(agent, history, businessProfile, memoryLog, callbacks, routingBrief, teamRoster);
  }
  if (agent.provider === "omniroute") {
    return streamAgentReplyOmniRoute(agent, history, businessProfile, memoryLog, callbacks, routingBrief, teamRoster);
  }
  return streamAgentReplyAnthropic(agent, history, businessProfile, memoryLog, callbacks, routingBrief, teamRoster);
}

// --- Autonomous next-step classification (deliverable done / hand off / ask the user) ---

export type NextStepDecision =
  | { type: "deliverable_complete"; deliverableType: string; title: string }
  | { type: "handoff_needed"; agentId: string; brief: string }
  | { type: "needs_user_input" }
  | { type: "task_complete" }
  | { type: "task_needs_revision"; note: string };

const NEXT_STEP_TOOL_NAME = "decide_next_step";
// This classifier is the one component whose entire job is to decide handoff (handoff_needed
// vs. deliverable_complete vs. needs_user_input) — per the "give handoff managers the bigger
// model" policy it runs on the full gpt-5.1 (not the cheaper gpt-5.1-mini default), independent
// of whichever provider the specialist that just replied happens to use.
const NEXT_STEP_CLASSIFIER_MODEL = "gpt-5.1";

const NEXT_STEP_SYSTEM_PROMPT = [
  "את/ה מסווג/ת החלטות פנימי בצוות AI שיווקי/מיתוגי — לא פונה למשתמש ישירות.",
  "תפקידך היחיד: לקרוא את התגובה האחרונה של סוכן, ולהחליט מה השלב הבא בתהליך.",
  "",
  "שלוש אפשרויות בלבד:",
  "- deliverable_complete — הסוכן מסר חומר קצה מוכן לשימוש בפועל על ידי הצוות. דוגמאות מובהקות: גאנט/לוח תוכן, בריף למשפיען/ית, תסריט וידאו, מאמר בלוג עם מילות מפתח SEO לאישור, דוח סופי, קופי סופי, רעיון קריאייטיב מגובש, טקסט/מלל מוכן לפרסום, המלצה אסטרטגית מגובשת. זה תמיד תוכן ממשי שאפשר להשתמש בו כמו שהוא — גם אם הוא עדיין ממתין לאישור המשתמש, כל עוד מדובר בחומר קצה בפועל ולא רק בתיאור/תוכנית מה ייווצר.",
  "- handoff_needed — הבקשה המקורית עדיין לא הושלמה במלואה, וסוכן/ית אחר/ת בצוות צריכ/ה להמשיך את העבודה (למשל: תוכן נכתב אבל צריך עכשיו בדיקת עקביות מיתוגית). ציינו agent_id מדויק מתוך הרשימה, ו-brief קצר עם מה שהסוכן הבא חייב לדעת.",
  '- needs_user_input — כל מה שאינו תוצר קצה בפועל: שאלת חידוד, בקשת אישור/הרשאה להמשיך (למשל "האם להפעיל את הצוות על זה?", "לאשר שאני ממשיך?"), עדכון סטטוס על תהליך, או כל תגובה שהיא על *התהליך* ולא *התוצר עצמו*. גם אם הסוכן "סיים לדבר" — אם מה שהוא אמר אינו חומר קצה שימושי, זו needs_user_input, לא deliverable_complete.',
  "",
  'דוגמה שלילית חשובה: "קיבלתי, אני מפעיל/ה את הצוות על הבריף הזה — לאשר?" הוא תיאום תהליך, לא תוצר — needs_user_input.',
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
      title: {
        type: "string",
        description:
          "רק אם decision=deliverable_complete: כותרת קצרה וברורה לתוצר (עד 80 תווים) שתוצג בעמוד התוצרים — " +
          'תיאור אמיתי של מה זה, לא מספר סידורי. לדוגמה: "רעיון לקמפיין השקת קולקציית הסתיו" או "גאנט תוכן לשבועיים הקרובים".',
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
  title?: string;
  agent_id?: string;
  brief?: string;
}

/** Narrower prompt/schema used once a plan already fixes which agent runs next — the classifier's
 *  only remaining job is judging whether *this* task's brief was actually fulfilled. */
function buildTaskCompletionSystemPrompt(task: PlanTask): string {
  return [
    "את/ה מסווג/ת החלטות פנימי בצוות AI שיווקי/מיתוגי — לא פונה למשתמש ישירות.",
    "לסוכן/ית שענה/תה הוקצתה משימה ספציפית מתוך תוכנית עבודה מאושרת:",
    `- כותרת המשימה: ${task.title}`,
    `- סוג התוצר הצפוי: ${task.deliverableType}`,
    `- דגשים למשימה: ${task.brief || "(אין דגשים נוספים)"}`,
    "",
    "תפקידך היחיד: לקרוא את התגובה האחרונה ולהחליט האם היא ממלאת את המשימה הזו במלואה.",
    "שלוש אפשרויות בלבד:",
    "- task_complete — התגובה היא חומר קצה שימושי בפועל שממלא את מה שהוגדר במשימה.",
    "- task_needs_revision — התגובה קרובה אך חסר בה משהו מהותי ביחס למשימה שהוגדרה; ציינו note קצר וממוקד עם מה בדיוק חסר.",
    "- needs_user_input — התגובה היא שאלת חידוד או בקשת אישור מהמשתמש שלא ניתן להתקדם בלעדיה.",
    "בספק — בחרו needs_user_input.",
  ].join("\n");
}

function buildTaskCompletionToolSchema() {
  return {
    type: "object" as const,
    properties: {
      decision: {
        type: "string",
        enum: ["task_complete", "task_needs_revision", "needs_user_input"],
        description: "האם המשימה שהוקצתה הושלמה",
      },
      note: {
        type: "string",
        description: "רק אם decision=task_needs_revision: מה חסר או צריך תיקון ביחס למשימה",
      },
    },
    required: ["decision"],
  };
}

interface TaskCompletionToolInput {
  decision: "task_complete" | "task_needs_revision" | "needs_user_input";
  note?: string;
}

/**
 * Runs after a specialist's reply finishes streaming — decides whether the turn is done (save
 * as a deliverable), needs another specialist to continue autonomously, or needs to stop and
 * show the user a real question. Deliberately fails safe: any error, missing tool call, or
 * unparseable response falls back to `needs_user_input`, i.e. today's behavior (show the reply,
 * do nothing automatic) — a classification hiccup should never silently drop or misroute work.
 *
 * The classification call itself always goes through OpenAI's `gpt-5.1` (`NEXT_STEP_CLASSIFIER_MODEL`)
 * regardless of which provider actually generated `replyText` — this is a small, separate
 * judgment call, not a re-run of the replying agent. It deliberately runs on the full model
 * rather than the cheaper `gpt-5.1-mini` default: this classifier is the one component whose
 * entire job is deciding handoff, and a misclassification here is exactly what causes
 * deliverables to silently go missing. It works the same for every agent provider (anthropic or
 * openai) with no added per-turn cost on the replying agent's own provider; an agent only skips
 * it via `auto_handoff_enabled: false` in its frontmatter, not based on which provider it's on.
 *
 * When `activeTask` is passed (executing an approved plan), which agent runs next is already
 * fixed by the plan's task graph — this call narrows to a single question: did this task's own
 * brief get fulfilled? (`task_complete` / `task_needs_revision` / `needs_user_input`). Without
 * `activeTask`, it keeps today's open-ended contract (`deliverable_complete` / `handoff_needed` /
 * `needs_user_input`), used for single-task turns and direct agent chats.
 */
// Cheap, deterministic floor applied before the classifier is even asked — no reply this short
// or this obviously a question back to the user should ever be eligible for deliverable_complete
// / task_complete, regardless of what the (fallible) classifier model might guess.
const MIN_DELIVERABLE_LENGTH = 40;

function looksLikeAClarifyingQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < MIN_DELIVERABLE_LENGTH) return true;
  // Hebrew or Latin question mark at the very end — a reply that closes by asking the user
  // something is coordinating next steps, not handing over finished work.
  return /[?？]\s*$/.test(trimmed);
}

export async function classifyNextStep(
  agent: AgentDef,
  replyText: string,
  originalRequest: string,
  specialists: AgentDef[],
  activeTask?: PlanTask
): Promise<NextStepDecision> {
  if (agent.auto_handoff_enabled === false || !replyText.trim() || looksLikeAClarifyingQuestion(replyText)) {
    return { type: "needs_user_input" };
  }

  const others = specialists.filter((s) => s.id !== agent.id);
  const specialistIds = others.map((s) => s.id);

  try {
    const client = getOpenAIClient();

    if (activeTask) {
      const response = await client.responses.create({
        model: NEXT_STEP_CLASSIFIER_MODEL,
        instructions: buildTaskCompletionSystemPrompt(activeTask),
        input: [
          {
            role: "user",
            content: `הבקשה המקורית מהמשתמש:\n${originalRequest.slice(0, 1000)}\n\nהתגובה של ${agent.name} (${agent.id}):\n${replyText.slice(0, 3000)}`,
          },
        ],
        max_output_tokens: 512,
        tools: [
          {
            type: "function",
            name: NEXT_STEP_TOOL_NAME,
            description: "קבע/י האם המשימה שהוקצתה הושלמה",
            parameters: buildTaskCompletionToolSchema(),
            strict: false,
          },
        ],
        tool_choice: { type: "function", name: NEXT_STEP_TOOL_NAME },
      });

      const call = response.output.find(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
      );
      if (!call) return { type: "needs_user_input" };

      const input = JSON.parse(call.arguments) as TaskCompletionToolInput;
      if (input.decision === "task_complete") return { type: "task_complete" };
      if (input.decision === "task_needs_revision") {
        return { type: "task_needs_revision", note: input.note?.trim() ?? "" };
      }
      return { type: "needs_user_input" };
    }

    const response = await client.responses.create({
      model: NEXT_STEP_CLASSIFIER_MODEL,
      instructions:
        NEXT_STEP_SYSTEM_PROMPT +
        "\n\n## חברי צוות זמינים להעברת עבודה (handoff_needed בלבד)\n" +
        buildRosterText(others),
      input: [
        {
          role: "user",
          content: `הבקשה המקורית מהמשתמש:\n${originalRequest.slice(0, 1000)}\n\nהתגובה של ${agent.name} (${agent.id}):\n${replyText.slice(0, 3000)}`,
        },
      ],
      max_output_tokens: 1024,
      tools: [
        {
          type: "function",
          name: NEXT_STEP_TOOL_NAME,
          description: "קבע/י את השלב הבא בתהליך",
          parameters: buildNextStepToolSchema(specialistIds),
          strict: false,
        },
      ],
      tool_choice: { type: "function", name: NEXT_STEP_TOOL_NAME },
    });

    const call = response.output.find(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    );
    if (!call) return { type: "needs_user_input" };

    const input = JSON.parse(call.arguments) as NextStepToolInput;

    if (input.decision === "handoff_needed" && input.agent_id && specialistIds.includes(input.agent_id)) {
      return { type: "handoff_needed", agentId: input.agent_id, brief: input.brief?.trim() ?? "" };
    }
    if (input.decision === "deliverable_complete") {
      return {
        type: "deliverable_complete",
        deliverableType: input.deliverable_type?.trim() || "general",
        title: input.title?.trim().slice(0, 80) || "",
      };
    }
    return { type: "needs_user_input" };
  } catch {
    return { type: "needs_user_input" };
  }
}
