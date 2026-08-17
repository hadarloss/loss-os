import { z } from "zod";
import { NextRequest } from "next/server";
import { getAgentById, getTeamTree } from "@/lib/agents/registry";
import { routeToAgent, proposePlan, ConversationMessage } from "@/lib/agents/router";
import { runOrchestrationLoop, sseLine } from "@/lib/agents/orchestration";
import { readBusinessProfile, getBusinessProfileStatus } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import { saveUpload } from "@/lib/fs/uploads";
import { getAnthropicClient, MissingApiKeyError } from "@/lib/anthropic/client";
import { getOpenAIClient, MissingOpenAIApiKeyError } from "@/lib/openai/client";
import { getOmniRouteClient, MissingOmniRouteConfigError } from "@/lib/omniroute/client";
import { AgentDef, MessageContentBlock, Provider, Team } from "@/lib/agents/types";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { ALL_MODEL_VALUES, modelOptionsForProvider } from "@/lib/agents/modelOptions";
import {
  createAgentJob,
  updateAgentJob,
  createPlan,
  createPlanTasks,
  getPlan,
  getResumableJob,
  getPlanByJobId,
  getInProgressTask,
} from "@/lib/db/queries";
import type { PlanTask } from "@/lib/agents/types";

function extractPlainText(content: string | MessageContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is Extract<MessageContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}


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
    filename: z.string().optional(),
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

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = ChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  const { brandId, agentId, team, message, history } = parsed.data;
  // Ignore anything outside the known model list rather than rejecting the request —
  // a stale client option shouldn't be able to break an otherwise-valid chat turn. Final
  // provider-match check happens per-agent in applyModelOverride below, since which agent
  // (and therefore which provider) answers isn't known yet for a team-routed request.
  const modelOverride = parsed.data.model && ALL_MODEL_VALUES.has(parsed.data.model)
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

  // Marketing/branding team work is locked until the business profile has been reviewed and
  // explicitly approved on the business-file page (see writeBusinessProfile's status
  // transitions) — onboarding and QA (both `team: "core"`) are always reachable regardless,
  // since onboarding is exactly the escape hatch out of this gate.
  const gateTeam = leadAgent?.team ?? (directAgent && (directAgent.team === "marketing" || directAgent.team === "branding") ? directAgent.team : null);
  if (gateTeam) {
    const status = await getBusinessProfileStatus(brandId);
    if (status !== "approved") {
      const reason =
        status === "template"
          ? "צריך קודם להשלים היכרות עם אורית לפני שאפשר לעבוד עם צוותי השיווק והמיתוג."
          : "תיק העסק ממתין לאישור שלך בעמוד \"תיק העסק\" לפני שאפשר להתחיל לעבוד עם הצוותים.";
      return Response.json({ error: reason, gate: status }, { status: 403 });
    }
  }

  // Best-effort: persist any image/document attachments in this message to the uploads
  // gallery. Never blocks or fails the chat turn itself — a save hiccup here just means the
  // file won't show up in the gallery, the reply still streams normally either way.
  if (Array.isArray(message)) {
    for (const block of message) {
      if (block.type !== "image" && block.type !== "document") continue;
      try {
        await saveUpload({
          brandId,
          userId: guard.user.id,
          filename: block.type === "image" ? block.filename ?? "תמונה" : block.title ?? "מסמך",
          kind: block.type,
          mimeType: block.source.media_type,
          base64Data: block.source.data,
        });
      } catch {
        // ignored — see comment above
      }
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
    // Override only ever swaps the model string within the agent's own provider — a client-sent
    // value that belongs to a different provider's option list (e.g. a leftover OpenAI selection
    // applied to an Anthropic agent after switching agents) is ignored rather than applied.
    modelOverride && modelOptionsForProvider(a.provider).some((o) => o.value === modelOverride)
      ? { ...a, model: modelOverride }
      : a;

  const originalRequestText = extractPlainText(message);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let agent = directAgent;
        let routingBrief: string | undefined;
        let resumedJobId: string | undefined;
        let resumedPlanTask: { id: string; task: PlanTask } | undefined;

        if (!agent && leadAgent) {
          // If the last turn on this team stopped waiting on the user — a clarifying question,
          // or a plan task the classifier couldn't resolve without more info — this new message
          // is almost certainly the answer. Continue that same job/plan instead of starting an
          // unrelated one, so an approved multi-agent plan doesn't silently die the moment one
          // task needs a clarification.
          const resumable = getResumableJob(brandId, leadAgent.team);
          if (resumable) {
            const pausedPlan = getPlanByJobId(resumable.id);
            const pausedTask = pausedPlan ? getInProgressTask(pausedPlan.id) : undefined;
            if (pausedPlan && pausedTask) {
              const resumeAgent =
                specialists.find((s) => s.id === pausedTask.agentId) ??
                (await getAgentById(pausedTask.agentId));
              if (resumeAgent) {
                agent = resumeAgent;
                routingBrief = pausedTask.brief;
                resumedJobId = resumable.id;
                resumedPlanTask = { id: pausedPlan.id, task: pausedTask };
                controller.enqueue(
                  sseLine({ type: "routing", from: leadAgent.id, to: resumeAgent.id, reason: "המשך תוכנית שהמתינה לתשובתך" })
                );
              }
            } else {
              // No plan involved — just a specialist's clarifying question. Nothing to resume by
              // task graph, but reuse the same job row so the dashboard shows one continuous turn
              // instead of an unrelated new one starting from scratch.
              resumedJobId = resumable.id;
            }
          }
        }

        if (!agent && leadAgent) {
          // Only a lead with more than one specialist can meaningfully plan a multi-agent
          // sequence — a single-specialist team always gets the immediate single-hop path.
          const teamCanPlan = specialists.length > 1;

          if (teamCanPlan) {
            const proposed = await proposePlan(leadAgent, specialists, fullHistory);

            if (proposed.tasks.length > 1) {
              // A real multi-agent plan — persist it and stop here. Nothing executes until the
              // user approves it via POST /api/plans/[id]/approve, which opens its own stream.
              const jobId = createAgentJob({
                brandId,
                team: leadAgent.team,
                leadAgentId: leadAgent.id,
                currentAgentId: proposed.tasks[0].agentId,
                label: "ממתין לאישור תוכנית",
              });
              updateAgentJob(jobId, { status: "plan_pending_approval" });

              const planId = createPlan({
                brandId,
                jobId,
                team: leadAgent.team,
                leadAgentId: leadAgent.id,
                goal: proposed.goal,
              });
              createPlanTasks(
                planId,
                proposed.tasks.map((t) => ({
                  agentId: t.agentId,
                  deliverableType: t.deliverableType,
                  title: t.title,
                  brief: t.brief,
                  dependsOnIndex: t.dependsOnIndex,
                }))
              );

              const plan = getPlan(planId)!;
              controller.enqueue(sseLine({ type: "plan_proposed", plan }));
              controller.close();
              return;
            }

            // A single-task "plan" degenerates into the ordinary immediate routing path —
            // no plan is persisted and no approval screen is shown.
            const task = proposed.tasks[0];
            agent = specialists.find((s) => s.id === task.agentId) ?? null;
            routingBrief = task.brief;
            controller.enqueue(
              sseLine({ type: "routing", from: leadAgent.id, to: task.agentId, reason: proposed.goal })
            );
          } else {
            const decision = await routeToAgent(leadAgent, specialists, fullHistory, businessProfile, memoryLog);
            agent = specialists.find((s) => s.id === decision.agentId) ?? null;
            routingBrief = decision.brief;
            controller.enqueue(
              sseLine({ type: "routing", from: leadAgent.id, to: decision.agentId, reason: decision.reason })
            );
          }
        }

        if (!agent) {
          controller.enqueue(sseLine({ type: "error", message: "סוכן לא נמצא לאחר ניתוב." }));
          controller.close();
          return;
        }

        agent = applyModelOverride(agent);

        // The autonomous handoff pool is the full specialist roster of the current agent's
        // team — already fetched above when routed through a lead, but not yet when the turn
        // started as a direct agent chat (e.g. picked from the sidebar). Same for the team's
        // lead: known already when routed through one, but needs its own lookup for a direct
        // agent chat so the team roster (below) is complete either way.
        let teamSpecialists = specialists;
        let teamLead = leadAgent;
        if (teamSpecialists.length === 0 && (agent.team === "marketing" || agent.team === "branding")) {
          const tree = await getTeamTree(agent.team);
          teamSpecialists = tree.specialists;
          teamLead = tree.lead;
        }
        // Fewer than 2 specialists (i.e. just this agent, or none) means there's no one to hand
        // off to — classification would offer an empty agent_id enum, which some providers
        // reject outright. Skip straight to today's behavior (stream, done, no auto-save).
        const canAutoManage = teamSpecialists.length > 1;

        // Full roster (lead + specialists) so every specialist's own reply — not just the lead's
        // routing decision — knows who its teammates are and what each of them does.
        const teamRoster: AgentDef[] = teamLead ? [teamLead, ...teamSpecialists] : teamSpecialists;

        // Visible on the dashboard sidebar without opening the chat — lets the user tell whether
        // a multi-agent (or even single-agent) turn is actively progressing or stuck. Reuse the
        // resumed job's row (if any) instead of creating a disconnected new one.
        const jobId =
          resumedJobId ??
          createAgentJob({
            brandId,
            team: agent.team,
            leadAgentId: leadAgent?.id,
            currentAgentId: agent.id,
            label: "עובד על הבקשה",
          });
        if (resumedJobId) {
          updateAgentJob(resumedJobId, { status: "running", currentAgentId: agent.id, label: "ממשיך בתוכנית" });
        }

        await runOrchestrationLoop({
          controller,
          brandId,
          leadAgentId: leadAgent?.id,
          jobId,
          businessProfile,
          memoryLog,
          fullHistory,
          originalRequestText,
          applyModelOverride,
          teamSpecialists,
          teamRoster,
          canAutoManage,
          agent,
          routingBrief,
          plan: resumedPlanTask,
        });
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
