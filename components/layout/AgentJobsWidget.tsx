"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

interface AgentJob {
  id: string;
  current_agent_id: string;
  status: "running" | "done" | "needs_input" | "error" | "plan_pending_approval";
  label: string;
  hop_count: number;
  started_at: string;
  updated_at: string;
}

interface AgentLite {
  id: string;
  name: string;
  icon: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const STATUS_DOT: Record<AgentJob["status"], string> = {
  running: "bg-amber-500 animate-pulse",
  done: "bg-green-500",
  needs_input: "bg-blue-500",
  error: "bg-destructive",
  plan_pending_approval: "bg-purple-500 animate-pulse",
};

function elapsedLabel(startedAt: string): string {
  // SQLite's datetime('now') yields "YYYY-MM-DD HH:MM:SS" (UTC, space-separated, no offset) —
  // needs reshaping into an ISO string before Date can parse it correctly.
  const iso = startedAt.includes("T") ? startedAt : `${startedAt.replace(" ", "T")}Z`;
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

/** Live per-agent job progress in the sidebar — visible without opening a chat, so a stuck or
 *  long-running autonomous multi-agent turn is obvious from the dashboard nav itself. */
export function AgentJobsWidget({ brandId }: { brandId: string }) {
  const { data } = useSWR<{ jobs: AgentJob[] }>(
    `/api/agent-jobs?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    { refreshInterval: 4000 }
  );
  const [agentsById, setAgentsById] = useState<Record<string, AgentLite>>({});

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, AgentLite> = {};
        for (const a of d.all ?? []) map[a.id] = { id: a.id, name: a.name, icon: a.icon };
        setAgentsById(map);
      })
      .catch(() => {});
  }, []);

  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-1 py-2 border-t border-border mt-1">
      <div className="text-[10px] font-medium text-muted-foreground px-1.5">🔄 עבודה פעילה</div>
      {jobs.map((job) => (
        // Shows *what* is being worked on, not *who* is working on it. The agent name (and the
        // raw snake_case id it fell back to when a skill file was renamed) is internal routing
        // detail the user neither chooses nor needs to follow.
        <div key={job.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[11px]" title={job.label}>
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[job.status]}`} aria-hidden />
          <span className="shrink-0" aria-hidden>
            ⚙️
          </span>
          <span className="truncate flex-1 text-sidebar-foreground/80">{job.label || "עובד על הבקשה"}</span>
          <span className="text-muted-foreground shrink-0">{elapsedLabel(job.started_at)}</span>
        </div>
      ))}
    </div>
  );
}
