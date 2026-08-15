import { z } from "zod";
import { NextRequest } from "next/server";
import { getAgentById, getTeamTree } from "@/lib/agents/registry";
import { routeToAgent, streamAgentReply, ConversationMessage } from "@/lib/agents/router";
import { readBusinessProfile } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import { getAnthropicClient, MissingApiKeyError } from "@/lib/anthropic/client";
import { getOpenAIClient, MissingOpenAIApiKeyError } from "@/lib/openai/client";
import { getOmniRouteClient, MissingOmniRouteConfigError } from "@/lib/omniroute/client";
import { AgentDef, ChatStreamEvent, Provider, Team } from "@/lib/agents/types";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { OMNIROUTE_MODEL_OPTIONS } from "@/lib/agents/modelOptions";

const OMNIROUTE_MODEL_VALUES = new Set(OMNIROUTE_MODEL_OPTIONS.map((o) => o.value));

// Generous but bounded cap on a single attachment's base64 payload (~15MB raw file).
const MAX_BASE64_LENGTH = 20_000_000;

const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().min(1) }),
  z.object({
    type: z.literal("image"),
    source: z.object({
      type: z.literal("base64"),
      media_type: z.enum(["image/jpeg", "image/png", "image/gif", "image/webp"]),
      data: z.string().max(MAX_BASE64_LENGTH),
    }),
  }),
  z.object({
    type: z.literal("document"),
    source: z.object({
      type: z.literal("base64"),
      media_type: z.literal("application/pdf"),
      data: z.string().max(MAX_BASE64_LENGTH),
    }),
    title: z.string().optional(),
  }),
]);

const MessageContentSchema = z.union([z.string().min(1), z.array(ContentBlockSchema).min(1)]);

const ChatRequestSchema = z.object({
  brandId: z.string().min(1),
  agentId: z.string().optional(),
  team: z.enum(["marketing", "branding"]).optional(),
  message: MessageContentSchema,
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: MessageContentSchema }))
    .default([]),
  /** User-picked per-session override of the replying agent's model — restricted server-side
   *  to the known OmniRoute combos regardless of what the client sends. */
  model: z.string().optional(),
});

function sseLine(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { brandId, agentId, team, message, history } = parsed.data;
  // Ignore anything outside the known combo list rather than rejecting the request —
  // a stale client option shouldn't be able to break an otherwise-valid chat turn.
  const modelOverride = parsed.data.model && OMNIROUTE_MODEL_VALUES.has(parsed.data.model)
    ? parsed.data.model
    : undefined;

  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  if (!agentId && !team) {
    return Response.json(
      { error: "יש לספק agentId (שיחה ישירה) או team (ניתוב דרך מנהל צוות)." },
      { status: 400 }
    );
  }

  // Resolve which agent(s) this request can touch up front — direct agent, or the team's
  // lead plus every specialist it might route to (the routing decision isn't known yet).
  let directAgent: AgentDef | null = null;
  let leadAgent: AgentDef | null = null;
  let specialists: AgentDef[] = [];

  if (agentId) {
    directAgent = await getAgentById(agentId);
    if (!directAgent) {
      return Response.json({ error: `סוכן לא נמצא: ${agentId}` }, { status: 400 });
    }
  } else {
    const tree = await getTeamTree(team as Team);
    leadAgent = tree.lead;
    specialists = tree.specialists;
    if (!leadAgent) {
      return Response.json({ error: `לא נמצא מנהל צוות עבור ${team}` }, { status: 400 });
    }
  }

  // Fail fast on a missing API key (for every provider this request could reach) with a
  // clean JSON error, instead of opening a stream that immediately errors.
  const providersNeeded = new Set<Provider>();
  for (const a of [directAgent, leadAgent, ...specialists]) {
    if (a) providersNeeded.add(a.provider);
  }
  try {
    for (const provider of providersNeeded) {
      if (provider === "openai") getOpenAIClient();
      else if (provider === "omniroute") getOmniRouteClient();
      else getAnthropicClient();
    }
  } catch (error) {
    if (
      error instanceof MissingApiKeyError ||
      error instanceof MissingOpenAIApiKeyError ||
      error instanceof MissingOmniRouteConfigError
    ) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    throw error;
  }

  const [businessProfile, memoryLog] = await Promise.all([
    readBusinessProfile(brandId),
    readMemoryLog(brandId),
  ]);

  const fullHistory: ConversationMessage[] = [...history, { role: "user", content: message }];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let agent = directAgent;
        let routingBrief: string | undefined;

        if (!agent && leadAgent) {
          const decision = await routeToAgent(leadAgent, specialists, fullHistory, businessProfile, memoryLog);
          agent = specialists.find((s) => s.id === decision.agentId) ?? null;
          routingBrief = decision.brief;
          controller.enqueue(
            sseLine({ type: "routing", from: leadAgent.id, to: decision.agentId, reason: decision.reason })
          );
        }

        if (!agent) {
          controller.enqueue(sseLine({ type: "error", message: "סוכן לא נמצא לאחר ניתוב." }));
          controller.close();
          return;
        }

        // Override only ever swaps the model string within the agent's own provider — the
        // dropdown only ever offers OmniRoute combos, so a non-OmniRoute agent's model is
        // left untouched even if a stale override value happens to be present.
        if (modelOverride && agent.provider === "omniroute") {
          agent = { ...agent, model: modelOverride };
        }

        await streamAgentReply(agent, fullHistory, businessProfile, memoryLog, {
          onText: (delta) => controller.enqueue(sseLine({ type: "token", text: delta })),
          onDone: () => {
            controller.enqueue(sseLine({ type: "done", handoff: null }));
            controller.close();
          },
          onError: (error) => {
            controller.enqueue(sseLine({ type: "error", message: error.message }));
            controller.close();
          },
        }, routingBrief);
      } catch (error) {
        controller.enqueue(
          sseLine({ type: "error", message: error instanceof Error ? error.message : String(error) })
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
