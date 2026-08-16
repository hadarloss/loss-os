import type { RoutingInfo, HandoffHop } from "@/components/chat/useAgentChat";

export interface AgentLite {
  name: string;
  icon: string;
  provider?: string;
  model?: string;
}

function AgentChip({ agent, emphasize }: { agent?: AgentLite; emphasize?: boolean }) {
  if (!agent) return null;
  return (
    <span
      className={
        emphasize
          ? "inline-flex items-center gap-1 font-medium text-foreground"
          : "inline-flex items-center gap-1"
      }
    >
      <span aria-hidden>{agent.icon}</span>
      {agent.name}
    </span>
  );
}

export function RoutingBreadcrumb({
  routing,
  agentsById,
  youLabel = "את/ה",
  handoffChain = [],
}: {
  /** Null in direct-agent chats (no lead routing happened) — still renders if handoffChain
   *  has hops, starting the chain from "את/ה" directly instead of via a lead. */
  routing: RoutingInfo | null;
  agentsById: Record<string, AgentLite>;
  youLabel?: string;
  /** Autonomous specialist-to-specialist handoffs that happened after the initial routing, in order. */
  handoffChain?: HandoffHop[];
}) {
  if (!routing && handoffChain.length === 0) return null;

  const from = routing ? agentsById[routing.from] : undefined;
  const to = routing ? agentsById[routing.to] : undefined;
  const finalHop = handoffChain[handoffChain.length - 1];
  const finalAgent = finalHop ? agentsById[finalHop.to] : undefined;
  // Direct-agent chat with a handoff and no lead routing: the chain starts from the first hop's
  // "from" agent (the one the user was actually talking to) instead of a lead → specialist pair.
  const leadingAgent = to ?? (handoffChain[0] ? agentsById[handoffChain[0].from] : undefined);

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <span>{youLabel}</span>
      <span aria-hidden>←</span>
      <AgentChip agent={from} />
      {from && <span aria-hidden>←</span>}
      <AgentChip agent={leadingAgent} emphasize={handoffChain.length === 0} />
      {handoffChain.map((hop, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span aria-hidden>←</span>
          <AgentChip agent={agentsById[hop.to]} emphasize={i === handoffChain.length - 1} />
        </span>
      ))}
      {leadingAgent?.model && handoffChain.length === 0 && (
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {leadingAgent.model}
        </span>
      )}
      {finalAgent?.model && handoffChain.length > 0 && (
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {finalAgent.model}
        </span>
      )}
      {(routing || finalHop) && (
        <span className="text-muted-foreground/80">
          — {finalHop ? finalHop.reason : routing!.reason}
        </span>
      )}
    </div>
  );
}
