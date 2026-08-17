"use client";

import type { AgentLite } from "@/components/chat/RoutingBreadcrumb";
import type { Plan } from "@/lib/agents/types";

const STATUS_LABEL: Record<string, string> = {
  pending: "ממתין",
  ready: "מוכן להתחלה",
  in_progress: "בעבודה",
  done: "הושלם",
  skipped: "דולג",
  failed: "נכשל",
};

const STATUS_DOT: Record<string, string> = {
  pending: "bg-muted-foreground/30",
  ready: "bg-muted-foreground/30",
  in_progress: "bg-amber-500 animate-pulse",
  done: "bg-green-500",
  skipped: "bg-muted-foreground/30",
  failed: "bg-destructive",
};

/**
 * Live progress for a multi-step piece of work — read-only.
 *
 * This used to be an approval gate the user had to click before anything ran. It isn't one
 * anymore: work starts as soon as the team has a plan, because being asked which agents should
 * run is exactly the decision the user said they don't want to make — and in practice the gate
 * was where planned work stopped and never resumed. What remains is visibility: which steps
 * exist, and how far along they are.
 */
export function PlanProgressCard({
  plan,
  agentsById,
  hideAgentIdentity = false,
}: {
  plan: Plan;
  agentsById: Record<string, AgentLite>;
  /** In a team workspace the steps are shown by what they produce, not by who produces them. */
  hideAgentIdentity?: boolean;
}) {
  return (
    <div className="self-stretch rounded-xl border border-border bg-muted/30 p-3.5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span aria-hidden>🗂️</span>
        <span className="text-sm font-medium">{plan.goal}</span>
      </div>

      <ol className="flex flex-col gap-2">
        {plan.tasks.map((task, i) => {
          const agent = hideAgentIdentity ? undefined : agentsById[task.agentId];
          return (
            <li key={task.id} className="flex items-start gap-2 text-sm">
              <span
                className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[task.status] ?? "bg-muted-foreground/30"}`}
                aria-hidden
              />
              <span className="text-muted-foreground shrink-0">{i + 1}.</span>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {agent && (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <span aria-hidden>{agent.icon}</span>
                      {agent.name}
                    </span>
                  )}
                  <span className={agent ? "text-muted-foreground" : "font-medium"}>
                    {agent ? `— ${task.title}` : task.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 rounded-full bg-background px-1.5 py-0.5">
                    {STATUS_LABEL[task.status] ?? task.status}
                  </span>
                </div>
                {task.brief && <span className="text-xs text-muted-foreground/80">{task.brief}</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
