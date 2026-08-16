import { randomUUID } from "crypto";
import { streamAgentReply, classifyNextStep, ConversationMessage } from "@/lib/agents/router";
import { saveOutput } from "@/lib/fs/outputs";
import { AgentDef, ChatStreamEvent, HandoffRecord, PlanTask, Team } from "@/lib/agents/types";
import {
  updateAgentJob,
  updatePlanTaskStatus,
  updatePlanStatus,
  getNextReadyTask,
  refreshReadyPlanTasks,
} from "@/lib/db/queries";

// Hard cap on autonomous steps (specialist-to-specialist handoffs, or plan tasks executed)
// within a single stream — a safety net against a classification loop, never expected to be
// hit in normal use.
const MAX_AUTONOMOUS_HOPS = 5;

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

/** Saving is a bonus, not a requirement — if it fails for any reason, the reply already
 *  streamed to the user in full, so there's nothing to roll back; callers just skip the
 *  output_saved event. */
async function persistDeliverable(
  params: PersistDeliverableParams
): Promise<{ id: string; format: string } | null> {
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
    return await saveOutput({
      brandId: params.brandId,
      team: params.team,
      agentId: params.agentId,
      content: params.content,
      handoff,
      title: params.title,
    });
  } catch {
    return null;
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
  canAutoManage: boolean;
  agent: AgentDef;
  routingBrief?: string;
  /** Present when executing an approved plan — task advancement follows the plan's task graph
   *  instead of the classifier picking an ad-hoc next agent. */
  plan?: { id: string; task: PlanTask };
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
    canAutoManage,
  } = params;

  let agent = params.agent;
  let routingBrief = params.routingBrief;
  let activeTask = params.plan?.task;
  const planId = params.plan?.id;
  const revisedTaskIds = new Set<string>();

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
      updateAgentJob(jobId, {
        status: activeTask ? "needs_input" : "done",
        label: activeTask ? "הגיע למגבלת הצעדים האוטונומיים" : "הסתיים",
      });
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
          content: fullText,
          deliverableType: activeTask.deliverableType,
          title: activeTask.title,
        });
        if (saved) {
          controller.enqueue(
            sseLine({ type: "output_saved", outputId: saved.id, format: saved.format, agentId: agent.id })
          );
        }
        updatePlanTaskStatus(activeTask.id, "done", saved?.id ?? undefined);
        controller.enqueue(
          sseLine({ type: "plan_task_update", planId: planId!, taskId: activeTask.id, status: "done", agentId: agent.id })
        );
        refreshReadyPlanTasks(planId!);

        const next = getNextReadyTask(planId!);
        if (!next) {
          updatePlanStatus(planId!, "done");
          updateAgentJob(jobId, { status: "done", label: "התוכנית הושלמה" });
          controller.enqueue(sseLine({ type: "done", handoff: null, resolvedModel: resolvedModelForHop }));
          controller.close();
          return;
        }

        const nextAgent = teamSpecialists.find((s) => s.id === next.agentId);
        if (!nextAgent) {
          updatePlanTaskStatus(next.id, "failed");
          updateAgentJob(jobId, { status: "error", label: `סוכן לא נמצא: ${next.agentId}` });
          controller.enqueue(sseLine({ type: "error", message: `הסוכן ${next.agentId} מהתוכנית לא נמצא.` }));
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
        content: fullText,
        deliverableType: decision.deliverableType,
        title: decision.title,
      });
      if (saved) {
        controller.enqueue(
          sseLine({ type: "output_saved", outputId: saved.id, format: saved.format, agentId: agent.id })
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
    agent = applyModelOverride(nextAgent);
    routingBrief = decision.brief;
  }
}
