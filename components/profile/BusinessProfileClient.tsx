"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function BusinessProfileClient({
  brandId,
  initialContent,
}: {
  brandId: string;
  initialContent: string;
}) {
  const { data, mutate } = useSWR<{ content: string; isTemplate: boolean }>(
    `/api/business-profile?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    { fallbackData: { content: initialContent, isTemplate: false }, refreshInterval: 7000 }
  );
  const content = data?.content ?? initialContent;
  const [draft, setDraft] = useState(initialContent);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Keep the draft synced with live-polled content while not actively editing,
  // so a change made elsewhere (chat, another tab) shows up without stomping local edits.
  useEffect(() => {
    if (!editing) setDraft(content);
  }, [content, editing]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/business-profile?brandId=${encodeURIComponent(brandId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      await mutate(updated, { revalidate: false });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end gap-2">
        {editing ? (
          <>
            <Button variant="ghost" onClick={() => { setDraft(content); setEditing(false); }} disabled={saving}>
              ביטול
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "שומר..." : "שמירה"}
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setEditing(true)}>
            ✏️ עריכה
          </Button>
        )}
      </div>

      {editing ? (
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="min-h-[60vh] font-mono text-sm"
        />
      ) : (
        <article className="whitespace-pre-wrap rounded-lg border border-border p-5 text-sm leading-relaxed">
          {content}
        </article>
      )}
    </div>
  );
}
