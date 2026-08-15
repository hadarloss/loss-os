"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { AgentDef, Team } from "@/lib/agents/types";

export function TeamSidebar({
  brandId,
  team,
  lead,
  specialists,
}: {
  brandId: string;
  team: Team;
  lead: AgentDef;
  specialists: AgentDef[];
}) {
  const pathname = usePathname();
  const teamHref = `/${brandId}/teams/${team}`;
  const isTeamHome = pathname === teamHref;

  return (
    <aside className="w-64 shrink-0 border-e border-border flex flex-col overflow-y-auto">
      <div className="p-3">
        <Link
          href={teamHref}
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
            isTeamHome
              ? "bg-accent text-accent-foreground font-medium"
              : "hover:bg-accent/60 text-foreground"
          )}
        >
          <span className="text-lg" aria-hidden>
            {lead.icon}
          </span>
          <span>
            <div className="font-medium">{lead.name}</div>
            <div className="text-xs text-muted-foreground">{lead.role}</div>
          </span>
        </Link>
      </div>

      <div className="px-3 pb-1 text-xs font-medium text-muted-foreground">חברי הצוות</div>
      <nav className="flex flex-col gap-0.5 p-3 pt-1">
        {specialists.map((agent) => {
          const href = `/${brandId}/teams/${team}/agents/${agent.id}`;
          const active = pathname === href;
          return (
            <Link
              key={agent.id}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-foreground/80 hover:bg-accent/60 hover:text-accent-foreground"
              )}
            >
              <span aria-hidden>{agent.icon}</span>
              <span className="truncate">{agent.name}</span>
              <span className="text-xs text-muted-foreground truncate">— {agent.role}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
