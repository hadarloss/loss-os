import { randomUUID } from "crypto";
import { streamAgentReply, classifyNextStep, ConversationMessage } from "@/lib/agents/router";
import { saveOutput } from "@/lib/fs/outputs";
import { extractDeliverable, stripDeliverableMarkers } from "@/lib/agents/deliverableMarkers";
import { AgentDef, ChatStreamEvent, HandoffRecord, PlanTask, Team } from "@/lib/agents/types";
import {
  updateAgentJob,
  updatePlanTaskStatus,
  updatePlanStatus,
  getNextReadyTask,
  refreshReadyPlanTasks,
  listUnfinishedPlanTasks,
} from "@/lib/db/queries";

// Hard cap on autonomous steps (specialist-to-specialist handoffs, or plan tasks executed)
// within a single stream — a safety net against a classification loop, never expected to be
// hit in normal use. A plan raises its own ceiling to its task count (see hopLimitFor): the flat
// 5 used to make any plan of 6-8 tasks structurally impossible to finish, since MAX_PLAN_TASKS
// is 8 — the run would abort mid-plan and lose the last task's output.
const MAX_AUTONOMOUS_HOPS = 5;

function hopLimitFor(taskCount?: number): number {
  return taskCount ? Math.max(MAX_AUTONOMOUS_HOPS, taskCount + 1) : MAX_AUTONOMOUS_HOPS;
}

/**
 * The instruction handed to the next agent when work moves between them.
 *
 * This exists because the loop appends each reply to `fullHistory` as an *assistant* turn, so the
 * next agent was previously invoked on a conversation ending in an assistant message it never
 * wrote but which the API presents as its own — with its actual assignment buried in the system
 * prompt. The natural continuation of that shape is commentary about what was just said, which is
 * exactly the "writes out tasks and processes but never does them" behavior users reported. An
 * explicit user turn makes the assignment an instruction the model must answer, not context it
 * may narrate. (The revision path already did this, and was notably the one hop that behaved.)
 */
function buildHandoffInstruction(params: {
  previousAgentName: string;
  previousTaskTitle?: string;
  nextTitle: string;
  nextBrief: string;
}): string {
  const source = params.previousTaskTitle
    ? `התוצר של ${params.previousAgentName} למשימה "${params.previousTaskTitle}" מופיע למעלה.`
    : `התגובה של ${params.previousAgentName} מופיעה למעלה.`;
  return [
    source,
    `המשימה שלך עכשיו: ${params.nextTitle}.`,
    params.nextBrief ? `דגשים: ${params.nextBrief}` : "",
    "הפק/י את התוצר עצמו במלואו, מוכן לשימוש — לא תיאור של מה תעשה/י ולא תוכנית עבודה.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function sseLine(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

interface PersistDeliverableParams {
  brandId: string;
  team: Team;
  agentId: string;
  leadAgentId?: string;
  content: string;
  deliverableType: string;
  title: string;
}

type PersistDeliverableResult =
  | { ok: true; id: string; format: string }
  | { ok: false; error: string };

/** The reply already streamed to the user in full, so a failed save never rolls anything back —
 *  but silently dropping it means a real deliverable never makes it to the outputs page with no
 *  trace. Callers surface `ok: false` to the user instead of just skipping the output_saved event. */
async function persistDeliverable(params: PersistDeliverableParams): Promise<PersistDeliverableResult> {
  const now = new Date().toISOString();
  const handoff: HandoffRecord = {
    task_id: randomUUID(),
    from_agent: params.leadAgentId ?? params.agentId,
    to_agent: params.agentId,
    status: "done",
    deliverable_type: params.deliverableType,
    output_path: null,
    requested_by: "auto",
    created_at: now,
    updated_at: now,
    notes: "",
  };
  try {
    const saved = await saveOutput({
      brandId: params.brandId,
      team: params.team,
      agentId: params.agentId,
      content: params.content,
      handoff,
      title: params.title,
    });
    return { ok: true, id: saved.id, format: saved.format };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[persistDeliverable] save failed brand=${params.brandId} agent=${params.agentId} type=${params.deliverableType}: ${message}`
    );
    return { ok: false, error: message };
  }
}

export interface OrchestrationParams {
  controller: ReadableStreamDefaultController<Uint8Array>;
  brandId: string;
  leadAgentId?: string;
  jobId: string;
  businessProfile: string;
  memoryLog: string;
  fullHistory: ConversationMessage[];
  originalRequestText: string;
  applyModelOverride: (a: AgentDef) => AgentDef;
  teamSpecialists: AgentDef[];
  /** Full team roster (lead + specialists) injected into every specialist's own system prompt so
   *  it knows who its teammates are and what each does — not just used for routing/classification. */
  teamRoster: AgentDef[];
  canAutoManage: boolean;
  agent: AgentDef;
  routingBrief?: string;
  /** Present when executing an approved plan — task advancement follows the plan's task graph
   *  instead of the classifier picking an ad-hoc next agent. `taskCount` raises the autonomous-hop
   *  ceiling to fit the plan (see hopLimitFor); omit it and a long plan aborts mid-run. */
  plan?: { id: string; task: PlanTask; taskCount?: number };
}

/**
 * Drives one turn's worth of agent replies to completion: streams each hop, classifies what
 * happens next, and closes the SSE stream once the turn is done, needs the user, or hits the
 * safety cap. Shared by the direct chat POST handler (legacy/single-task mode, `plan` unset)
 * and the plan-approval endpoint (plan-execution mode, `plan` set) so both follow identical
 * streaming/job-tracking/error-handling behavior.
 */
export async function runOrchestrationLoop(params: OrchestrationParams): Promise<void> {
  const {
    controller,
    brandId,
    leadAgentId,
    jobId,
    businessProfile,
    memoryLog,
    fullHistory,
    originalRequestText,
    applyModelOverride,
    teamSpecialists,
    teamRoster,
    canAutoManage,
  } = params;

  let agent = params.agent;
  let routingBrief = params.routingBrief;
  let activeTask = params.plan?.task;
  const planId = params.plan?.id;
  const revisedTaskIds = new Set<string>();
  const hopLimit = hopLimitFor(params.plan?.taskCount);

  let hop = 0;
  while (true) {
    let fullText = "";
    let resolvedModelForHop: string | undefined;
    let streamError: Error | null = null;

    await new Promise<void>((resolve) => {
      streamAgentReply(
        agent,
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
        routingBrief,
        teamRoster
      ).catch((error) => {
        streamError = error instanceof Error ? error : new Error(String(error));
        resolve();
      });
    });

    if (streamError) {
      console.error(
        `[runOrchestrationLoop] stream failed brand=${brandId} agent=${agent.id} job=${jobId}: ${(streamError as Error).message}`
      );
      updateAgentJob(jobId, { status: "error", label: (streamError as Error).message.slice(0, 200) });
      controller.enqueue(sseLine({ type: "error", message: (streamError as Error).message }));
      controller.close();
      return;
    }

    if (!canAutoManage) {
      updateAgentJob(jobId, { status: "done", label: "הסתיים" });
      controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
      controller.close();
      return;
    }

    if (hop >= hopLimit) {
      // The autonomous loop ran out of steps without ever resolving to a finished deliverable —
      // the last reply is still shown to the user (already streamed above), but nothing was
      // auto-saved. Surface that explicitly instead of just closing quietly, so the user knows
      // to save/ask manually rather than assuming the work is sitting in the outputs page.
      updateAgentJob(jobId, { status: "needs_input", label: "הגיע למגבלת הצעדים האוטונומיים" });
      controller.enqueue(
        sseLine({
          type: "error",
          message:
            "התהליך האוטומטי בין הסוכנים הגיע למגבלת הצעדים בלי לזהות תוצר סופי — התגובה האחרונה מוצגת למעלה, אך היא לא נשמרה אוטומטית כתוצר.",
        })
      );
      controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
      controller.close();
      return;
    }

    fullHistory.push({ role: "assistant", content: fullText });

    if (activeTask) {
      const decision = await classifyNextStep(agent, fullText, originalRequestText, teamSpecialists, activeTask);

      if (decision.type === "task_complete") {
        const saved = await persistDeliverable({
          brandId,
          team: agent.team as Team,
          agentId: agent.id,
          leadAgentId,
          content: extractDeliverable(fullText) ?? stripDeliverableMarkers(fullText),
          deliverableType: activeTask.deliverableType,
          title: activeTask.title,
        });
        if (saved.ok) {
          controller.enqueue(
            sseLine({ type: "output_saved", outputId: saved.id, format: saved.format, agentId: agent.id })
          );
        } else {
          controller.enqueue(
            sseLine({
              type: "error",
              message: `התגובה מוכנה, אך שמירתה כתוצר בעמוד התוצרים נכשלה: ${saved.error}`,
            })
          );
        }
        updatePlanTaskStatus(activeTask.id, "done", saved.ok ? saved.id : undefined);
        controller.enqueue(
          sseLine({ type: "plan_task_update", planId: planId!, taskId: activeTask.id, status: "done", agentId: agent.id })
        );
        refreshReadyPlanTasks(planId!);

        // Pull the next executable task, skipping any whose agent no longer exists. A plan can
        // outlive the roster it was built against (an agent renamed or removed under skills/) —
        // that used to abort the entire run with a raw "הסוכן X מהתוכנית לא נמצא", which is the
        // "old agent, apparently expired" error users hit. Fail just that task and carry on.
        let next = getNextReadyTask(planId!);
        let nextAgent = next ? teamSpecialists.find((s) => s.id === next!.agentId) : undefined;
        while (next && !nextAgent) {
          updatePlanTaskStatus(next.id, "failed");
          controller.enqueue(
            sseLine({
              type: "plan_task_update",
              planId: planId!,
              taskId: next.id,
              status: "failed",
              agentId: next.agentId,
            })
          );
          refreshReadyPlanTasks(planId!);
          next = getNextReadyTask(planId!);
          nextAgent = next ? teamSpecialists.find((s) => s.id === next!.agentId) : undefined;
        }

        if (!next || !nextAgent) {
          // No ready task has two very different meanings. Everything finished — or the graph is
          // stuck (a dependency failed/was skipped, or a malformed dependency can never resolve).
          // Reporting the second as "התוכנית הושלמה" is what made a plan that ran one task out of
          // five look like a success, so check for survivors before claiming completion.
          const unfinished = listUnfinishedPlanTasks(planId!);
          if (unfinished.length > 0) {
            updatePlanStatus(planId!, "cancelled");
            updateAgentJob(jobId, { status: "error", label: "התוכנית נתקעה" });
            controller.enqueue(
              sseLine({
                type: "error",
                message: `חלק מהשלבים לא בוצעו: ${unfinished
                  .map((t) => t.title)
                  .join(", ")}. מה שכן הושלם נשמר בעמוד התוצרים.`,
              })
            );
            controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
            controller.close();
            return;
          }
          updatePlanStatus(planId!, "done");
          updateAgentJob(jobId, { status: "done", label: "התוכנית הושלמה" });
          controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
          controller.close();
          return;
        }

        updatePlanTaskStatus(next.id, "in_progress");
        hop++;
        updateAgentJob(jobId, { currentAgentId: nextAgent.id, label: next.title, hopCount: hop });
        controller.enqueue(
          sseLine({ type: "plan_task_update", planId: planId!, taskId: next.id, status: "in_progress", agentId: nextAgent.id })
        );
        controller.enqueue(
          sseLine({ type: "handoff", from: agent.id, to: nextAgent.id, reason: next.brief || next.title })
        );

        // Hand the work over explicitly — see buildHandoffInstruction for why this turn is what
        // makes the next agent produce the artifact instead of narrating the process.
        fullHistory.push({
          role: "user",
          content: buildHandoffInstruction({
            previousAgentName: agent.name,
            previousTaskTitle: activeTask.title,
            nextTitle: next.title,
            nextBrief: next.brief,
          }),
        });

        agent = applyModelOverride(nextAgent);
        routingBrief = next.brief;
        activeTask = next;
        continue;
      }

      if (decision.type === "task_needs_revision") {
        if (revisedTaskIds.has(activeTask.id)) {
          // Already retried this task once — stop rather than loop indefinitely.
          updateAgentJob(jobId, { status: "needs_input", label: "ממתין לתשובה מהמשתמש" });
          controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
          controller.close();
          return;
        }
        revisedTaskIds.add(activeTask.id);
        fullHistory.push({
          role: "user",
          content: `יש להשלים/לתקן את התגובה הקודמת ביחס למשימה "${activeTask.title}": ${decision.note || "נדרש פירוט נוסף."}`,
        });
        continue;
      }

      // needs_user_input
      updateAgentJob(jobId, { status: "needs_input", label: "ממתין לתשובה מהמשתמש" });
      controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
      controller.close();
      return;
    }

    // Legacy (no active plan) mode — single-task turns and direct agent chats.
    const decision = await classifyNextStep(agent, fullText, originalRequestText, teamSpecialists);

    if (decision.type === "deliverable_complete") {
      const saved = await persistDeliverable({
        brandId,
        team: agent.team as Team,
        agentId: agent.id,
        leadAgentId,
        content: extractDeliverable(fullText) ?? stripDeliverableMarkers(fullText),
        deliverableType: decision.deliverableType,
        title: decision.title,
      });
      if (saved.ok) {
        controller.enqueue(
          sseLine({ type: "output_saved", outputId: saved.id, format: saved.format, agentId: agent.id })
        );
      } else {
        controller.enqueue(
          sseLine({
            type: "error",
            message: `התגובה מוכנה, אך שמירתה כתוצר בעמוד התוצרים נכשלה: ${saved.error}`,
          })
        );
      }
      updateAgentJob(jobId, { status: "done", label: decision.title || "תוצר נשמר" });
      controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
      controller.close();
      return;
    }

    if (decision.type !== "handoff_needed") {
      // needs_user_input, or (never actually returned outside plan mode) task_complete/task_needs_revision.
      updateAgentJob(jobId, { status: "needs_input", label: "ממתין לתשובה מהמשתמש" });
      controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
      controller.close();
      return;
    }

    const nextAgent = teamSpecialists.find((s) => s.id === decision.agentId);
    if (!nextAgent) {
      updateAgentJob(jobId, { status: "done", label: "הסתיים" });
      controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
      controller.close();
      return;
    }
    hop++;
    updateAgentJob(jobId, { currentAgentId: nextAgent.id, label: decision.brief || "המשך עבודה", hopCount: hop });
    controller.enqueue(
      sseLine({ type: "handoff", from: agent.id, to: nextAgent.id, reason: decision.brief || "המשך עבודה" })
    );

    // Same explicit hand-off as the plan path — without it the next agent inherits a history
    // ending in someone else's assistant turn and tends to comment on it rather than do the work.
    fullHistory.push({
      role: "user",
      content: buildHandoffInstruction({
        previousAgentName: agent.name,
        nextTitle: decision.brief || "המשך העבודה על הבקשה המקורית",
        nextBrief: decision.brief,
      }),
    });

    agent = applyModelOverride(nextAgent);
    routingBrief = decision.brief;
  }
}
