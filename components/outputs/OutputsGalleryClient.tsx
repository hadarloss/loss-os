"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { OutputSummary } from "@/lib/fs/outputs";
import type { Team } from "@/lib/agents/types";

interface SpecialistLite {
  id: string;
  name: string;
  icon: string;
  team: Team | "core";
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const STATUS_LABEL: Record<OutputSummary["status"], string> = {
  pending: "ממתין לאישור",
  approved: "מאושר",
  rejected: "נדחה",
};

const STATUS_VARIANT: Record<OutputSummary["status"], "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

export function OutputsGalleryClient({
  brandId,
  outputs: initialOutputs,
  specialists,
}: {
  brandId: string;
  outputs: OutputSummary[];
  specialists: SpecialistLite[];
}) {
  const { data, mutate } = useSWR<{ outputs: OutputSummary[] }>(
    `/api/outputs?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    { fallbackData: { outputs: initialOutputs }, refreshInterval: 7000 }
  );
  const outputs = data?.outputs ?? initialOutputs;

  const [selected, setSelected] = useState<OutputSummary | null>(null);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const openOutput = async (output: OutputSummary) => {
    if (output.format === "xlsx") {
      setSelected(output);
      setContent("");
      return;
    }
    setSelected(output);
    setLoading(true);
    setContent("");
    try {
      const res = await fetch(
        `/api/outputs?brandId=${encodeURIComponent(brandId)}&team=${output.team}&filename=${encodeURIComponent(output.filename)}`
      );
      const data = await res.json();
      setContent(data.content ?? "");
    } finally {
      setLoading(false);
    }
  };

  const outputsByAgent = new Map<string, OutputSummary[]>();
  for (const o of outputs) {
    outputsByAgent.set(o.agentId, [...(outputsByAgent.get(o.agentId) ?? []), o]);
  }
  // Agents with at least one output, in registry order; any agent_id present on an output but
  // no longer in the registry (renamed/removed skill file) still gets a fallback section.
  const knownIds = new Set(specialists.map((s) => s.id));
  const orphanAgentIds = [...outputsByAgent.keys()].filter((id) => !knownIds.has(id));
  const sections: SpecialistLite[] = [
    ...specialists.filter((s) => outputsByAgent.has(s.id)),
    ...orphanAgentIds.map((id) => ({ id, name: id, icon: "🤖", team: "core" as const })),
  ];

  if (sections.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">אין עדיין תוצרים שמורים כאן.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.map((agent) => (
        <div key={agent.id} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <span aria-hidden>{agent.icon}</span>
            {agent.name}
            <span className="text-xs text-muted-foreground font-normal">
              ({outputsByAgent.get(agent.id)?.length ?? 0})
            </span>
          </h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {outputsByAgent.get(agent.id)?.map((item) => (
              <OutputCard key={item.id} brandId={brandId} item={item} onOpen={openOutput} onChanged={() => mutate()} />
            ))}
          </div>
        </div>
      ))}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
            <DialogDescription>
              {selected?.agentId} · {selected?.deliverableType}
            </DialogDescription>
          </DialogHeader>
          {selected?.format === "xlsx" ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">קובץ אקסל — אין תצוגה מקדימה כאן.</p>
              <a
                href={`/api/outputs/${selected.id}/file?brandId=${encodeURIComponent(brandId)}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-sm hover:bg-muted"
              >
                ⬇️ הורדת קובץ אקסל
              </a>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed">
              {loading ? "טוען..." : content}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OutputCard({
  brandId,
  item,
  onOpen,
  onChanged,
}: {
  brandId: string;
  item: OutputSummary;
  onOpen: (output: OutputSummary) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const decide = async (status: "approved" | "rejected") => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/outputs/${item.id}?brandId=${encodeURIComponent(brandId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      onChanged();
    } catch {
      setActionError("שגיאה — נסה/י שוב");
    } finally {
      setBusy(false);
    }
  };

  const submitRevision = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/outputs/${item.id}/revise?brandId=${encodeURIComponent(brandId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "שגיאה");
      setNote("");
      setNoteOpen(false);
      onChanged();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "שגיאה בבקשת שיפורים");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <button onClick={() => onOpen(item)} className="text-start min-w-0">
            <CardTitle className="text-sm truncate">
              {item.format === "xlsx" && <span aria-hidden>📊 </span>}
              {item.title}
            </CardTitle>
            <CardDescription>
              {item.deliverableType} · גרסה {item.version}
            </CardDescription>
          </button>
          <Badge variant={STATUS_VARIANT[item.status]} className="shrink-0">
            {STATUS_LABEL[item.status]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("approved")}>
            ✓ אישור
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decide("rejected")}>
            ✕ דחייה
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setNoteOpen((v) => !v)}>
            ✏️ בקש שיפורים
          </Button>
        </div>
        {noteOpen && (
          <div className="flex flex-col gap-1.5">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 100))}
              placeholder="מה לשפר? (עד 100 תווים)"
              maxLength={100}
              className="rounded-md border border-input bg-transparent px-2 py-1.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{note.length}/100</span>
              <Button size="sm" disabled={busy || !note.trim()} onClick={submitRevision}>
                {busy ? "שולח..." : "שליחה"}
              </Button>
            </div>
          </div>
        )}
        {actionError && <span className="text-xs text-destructive">{actionError}</span>}
      </CardContent>
    </Card>
  );
}
