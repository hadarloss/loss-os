import type { RoutingInfo } from "@/components/chat/useAgentChat";

export interface AgentLite {
  name: string;
  icon: string;
  provider?: string;
  model?: string;
}

export function RoutingBreadcrumb({
  routing,
  agentsById,
  youLabel = "את/ה",
}: {
  routing: RoutingInfo;
  agentsById: Record<string, AgentLite>;
  youLabel?: string;
}) {
  const from = agentsById[routing.from];
  const to = agentsById[routing.to];

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>{youLabel}</span>
      <span aria-hidden>←</span>
      {from && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>{from.icon}</span>
          {from.name}
        </span>
      )}
      <span aria-hidden>←</span>
      {to && (
        <span className="inline-flex items-center gap-1 font-medium text-foreground">
          <span aria-hidden>{to.icon}</span>
          {to.name}
          {to.model && (
            <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
              {to.model}
            </span>
          )}
        </span>
      )}
      <span className="text-muted-foreground/80">— {routing.reason}</span>
    </div>
  );
}
