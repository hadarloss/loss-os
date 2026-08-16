import { randomUUID } from "crypto";
import { z } from "zod";
import { NextRequest } from "next/server";
import { getAgentById, getTeamTree } from "@/lib/agents/registry";
import { routeToAgent, streamAgentReply, classifyNextStep, ConversationMessage } from "@/lib/agents/router";
import { readBusinessProfile } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import { saveOutput } from "@/lib/fs/outputs";
import { getAnthropicClient, MissingApiKeyError } from "@/lib/anthropic/client";
import { getOpenAIClient, MissingOpenAIApiKeyError } from "@/lib/openai/client";
import { getOmniRouteClient, MissingOmniRouteConfigError } from "@/lib/omniroute/client";
import { AgentDef, ChatStreamEvent, HandoffRecord, MessageContentBlock, Provider, Team } from "@/lib/agents/types";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { OMNIROUTE_MODEL_OPTIONS } from "@/lib/agents/modelOptions";
import { createAgentJob, updateAgentJob } from "@/lib/db/queries";

// Hard cap on autonomous specialist-to-specialist handoffs within a single user turn — a
// safety net against a classification loop, never expected to be hit in normal use.
const MAX_AUTONOMOUS_HOPS = 5;

function extractPlainText(content: string | MessageContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is Extract<MessageContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

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

  const applyModelOverride = (a: AgentDef): AgentDef =>
    // Override only ever swaps the model string within the agent's own provider — the dropdown
    // only ever offers OmniRoute combos, so a non-OmniRoute agent's model is left untouched even
    // if a stale override value happens to be present.
    modelOverride && a.provider === "omniroute" ? { ...a, model: modelOverride } : a;

  const originalRequestText = extractPlainText(message);

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

        agent = applyModelOverride(agent);

        // The autonomous handoff pool is the full specialist roster of the current agent's
        // team — already fetched above when routed through a lead, but not yet when the turn
        // started as a direct agent chat (e.g. picked from the sidebar).
        let teamSpecialists = specialists;
        if (teamSpecialists.length === 0 && (agent.team === "marketing" || agent.team === "branding")) {
          const tree = await getTeamTree(agent.team);
          teamSpecialists = tree.specialists;
        }
        // Fewer than 2 specialists (i.e. just this agent, or none) means there's no one to hand
        // off to — classification would offer an empty agent_id enum, which some providers
        // reject outright. Skip straight to today's behavior (stream, done, no auto-save).
        const canAutoManage = teamSpecialists.length > 1;

        // Visible on the dashboard sidebar without opening the chat — lets the user tell whether
        // a multi-agent (or even single-agent) turn is actively progressing or stuck.
        const jobId = createAgentJob({
          brandId,
          team: agent.team,
          leadAgentId: leadAgent?.id,
          currentAgentId: agent.id,
          label: "עובד על הבקשה",
        });

        let hop = 0;
        while (true) {
          let fullText = "";
          let resolvedModelForHop: string | undefined;
          let streamError: Error | null = null;

          await new Promise<void>((resolve) => {
            streamAgentReply(
              agent!,
              fullHistory,
              businessProfile,
              memoryLog,
              {
                onText: (delta) => {
                  fullText += delta;
                  controller.enqueue(sseLine({ type: "token", text: delta }));
                },
                onDone: (text, resolvedModel) => {
                  fullText = text;
                  resolvedModelForHop = resolvedModel;
                  resolve();
                },
                onError: (error) => {
                  streamError = error;
                  resolve();
                },
              },
              routingBrief
            ).catch((error) => {
              streamError = error instanceof Error ? error : new Error(String(error));
              resolve();
            });
          });

          if (streamError) {
            updateAgentJob(jobId, { status: "error", label: (streamError as Error).message.slice(0, 200) });
            controller.enqueue(sseLine({ type: "error", message: (streamError as Error).message }));
            controller.close();
            return;
          }

          if (!canAutoManage || hop >= MAX_AUTONOMOUS_HOPS) {
            updateAgentJob(jobId, { status: "done", label: "הסתיים" });
            controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
            controller.close();
            return;
          }

          // Keep the running history in sync so a subsequent hop (or the classifier) sees this
          // reply as prior context, same as a normal back-and-forth turn would.
          fullHistory.push({ role: "assistant", content: fullText });

          const decision = await classifyNextStep(agent, fullText, originalRequestText, teamSpecialists);

          if (decision.type === "deliverable_complete") {
            const now = new Date().toISOString();
            const handoff: HandoffRecord = {
              task_id: randomUUID(),
              from_agent: leadAgent?.id ?? agent.id,
              to_agent: agent.id,
              status: "done",
              deliverable_type: decision.deliverableType,
              output_path: null,
              requested_by: "auto",
              created_at: now,
              updated_at: now,
              notes: "",
            };
            try {
              const saved = await saveOutput({
                brandId,
                team: agent.team as Team,
                agentId: agent.id,
                content: fullText,
                handoff,
                title: decision.title,
              });
              controller.enqueue(
                sseLine({ type: "output_saved", outputId: saved.id, format: saved.format, agentId: agent.id })
              );
            } catch {
              // Saving is a bonus, not a requirement — if it fails for any reason, the reply
              // already streamed to the user in full, so there's nothing to roll back.
            }
            updateAgentJob(jobId, { status: "done", label: decision.title || "תוצר נשמר" });
            controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
            controller.close();
            return;
          }

          if (decision.type === "needs_user_input") {
            updateAgentJob(jobId, { status: "needs_input", label: "ממתין לתשובה מהמשתמש" });
            controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
            controller.close();
            return;
          }

          // handoff_needed
          const nextAgent = teamSpecialists.find((s) => s.id === decision.agentId);
          if (!nextAgent) {
            updateAgentJob(jobId, { status: "done", label: "הסתיים" });
            controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
            controller.close();
            return;
          }
          hop++;
          updateAgentJob(jobId, {
            currentAgentId: nextAgent.id,
            label: decision.brief || "המשך עבודה",
            hopCount: hop,
          });
          controller.enqueue(
            sseLine({ type: "handoff", from: agent.id, to: nextAgent.id, reason: decision.brief || "המשך עבודה" })
          );
          agent = applyModelOverride(nextAgent);
          routingBrief = decision.brief;
        }
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
