import { z } from "zod";
import { NextRequest } from "next/server";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { getAgentById, getTeamTree } from "@/lib/agents/registry";
import { ConversationMessage } from "@/lib/agents/router";
import { runOrchestrationLoop, sseLine } from "@/lib/agents/orchestration";
import { readBusinessProfile } from "@/lib/fs/businessProfile";
import { readMemoryLog } from "@/lib/fs/memoryLog";
import {
  getPlan,
  updatePlanStatus,
  updatePlanTaskStatus,
  updateAgentJob,
  createAgentJob,
  refreshReadyPlanTasks,
  getNextReadyTask,
} from "@/lib/db/queries";
import { Team } from "@/lib/agents/types";

// Plain-text history only — plan approval doesn't need to replay file attachments from the
// original turn, just enough conversational context for the first task's agent to pick up.
const ApproveSchema = z.object({
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
    .optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "קלט לא תקין" }, { status: 400 });
  }

  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const plan = getPlan(id);
  if (!plan || plan.brandId !== brandId) {
    return Response.json({ error: "תוכנית לא נמצאה" }, { status: 404 });
  }
  if (plan.status !== "pending_approval") {
    return Response.json({ error: "התוכנית כבר אושרה, בוטלה, או הסתיימה" }, { status: 409 });
  }
  if (!plan.team) {
    return Response.json({ error: "לתוכנית אין צוות משויך" }, { status: 400 });
  }

  refreshReadyPlanTasks(id);
  const firstTask = getNextReadyTask(id);
  if (!firstTask) {
    return Response.json({ error: "לא נמצאה משימה ראשונה מוכנה בתוכנית" }, { status: 500 });
  }

  const agent = await getAgentById(firstTask.agentId);
  if (!agent) {
    return Response.json({ error: `הסוכן ${firstTask.agentId} לא נמצא` }, { status: 404 });
  }

  const tree = await getTeamTree(plan.team as Team);
  const teamSpecialists = tree.specialists;
  const teamRoster = tree.lead ? [tree.lead, ...teamSpecialists] : teamSpecialists;

  const [businessProfile, memoryLog] = await Promise.all([
    readBusinessProfile(brandId!),
    readMemoryLog(brandId!),
  ]);

  const fullHistory: ConversationMessage[] =
    parsed.data.history && parsed.data.history.length > 0
      ? parsed.data.history
      : [{ role: "user", content: plan.goal }];

  updatePlanStatus(id, "approved");
  updatePlanTaskStatus(firstTask.id, "in_progress");

  // A plan is always created together with its job in the chat flow, but job_id is nullable in
  // the schema — fall back to creating one so an orphaned plan can still be executed/tracked.
  const jobId =
    plan.jobId ??
    createAgentJob({
      brandId: brandId!,
      team: plan.team,
      leadAgentId: plan.leadAgentId ?? undefined,
      currentAgentId: agent.id,
      label: firstTask.title,
    });
  updateAgentJob(jobId, { status: "running", currentAgentId: agent.id, label: firstTask.title });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runOrchestrationLoop({
          controller,
          brandId: brandId!,
          leadAgentId: plan.leadAgentId ?? undefined,
          jobId,
          businessProfile,
          memoryLog,
          fullHistory,
          originalRequestText: plan.goal,
          applyModelOverride: (a) => a,
          teamSpecialists,
          teamRoster,
          canAutoManage: true,
          agent,
          routingBrief: firstTask.brief,
          plan: { id, task: firstTask },
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
