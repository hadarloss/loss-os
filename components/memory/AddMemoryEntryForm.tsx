"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const TYPES = [
  { value: "correction", label: "תיקון" },
  { value: "new_rule", label: "כלל חדש" },
  { value: "preference", label: "העדפה" },
  { value: "note", label: "הערה" },
] as const;

export function AddMemoryEntryForm({ brandId, onSaved }: { brandId: string; onSaved?: () => void }) {
  const [agent, setAgent] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("note");
  const [summary, setSummary] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSubmit = async () => {
    if (!summary.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/memory-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandId, agent: agent.trim() || "user", type, summary: summary.trim() }),
      });
      if (!res.ok) throw new Error();
      setSummary("");
      setAgent("");
      setOpen(false);
      onSaved?.();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        ➕ הוספת רשומה ליומן
      </Button>
    );
  }

  return (
    <div className="rounded-lg border border-border p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          placeholder="שם הסוכן/מקור (ברירת מחדל: user)"
          className="flex-1 min-w-40 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
          className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <Textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="תקציר הכלל/הפידבק..."
      />
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
          ביטול
        </Button>
        <Button onClick={handleSubmit} disabled={submitting || !summary.trim()}>
          {submitting ? "שומר..." : "שמירה"}
        </Button>
      </div>
    </div>
  );
}
