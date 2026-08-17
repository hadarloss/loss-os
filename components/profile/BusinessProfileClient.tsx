"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { ProfileStatus } from "@/lib/fs/businessProfile";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

const STATUS_LABEL: Record<ProfileStatus, string> = {
  template: "טרם הוגדר",
  pending_approval: "ממתין לאישור",
  approved: "מאושר",
};

const STATUS_VARIANT: Record<ProfileStatus, "secondary" | "default" | "outline"> = {
  template: "secondary",
  pending_approval: "default",
  approved: "outline",
};

export function BusinessProfileClient({
  brandId,
  initialContent,
  initialStatus,
}: {
  brandId: string;
  initialContent: string;
  initialStatus: ProfileStatus;
}) {
  const router = useRouter();
  const { data, mutate } = useSWR<{ content: string; isTemplate: boolean; status: ProfileStatus }>(
    `/api/business-profile?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    {
      fallbackData: { content: initialContent, isTemplate: false, status: initialStatus },
      refreshInterval: 7000,
    }
  );
  const content = data?.content ?? initialContent;
  const status = data?.status ?? initialStatus;
  const [draft, setDraft] = useState(initialContent);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [revising, setRevising] = useState(false);
  const [showRevisionBox, setShowRevisionBox] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");
  const [revisionError, setRevisionError] = useState<string | null>(null);

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

  const handleApprove = async () => {
    setApproving(true);
    try {
      const res = await fetch(`/api/business-profile/approve?brandId=${encodeURIComponent(brandId)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      await mutate();
      router.refresh();
    } catch {
      window.alert("האישור נכשל — נסו שוב.");
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    const confirmed = window.confirm(
      "לדחות את תיק העסק? הטיוטה תימחק ותחזרו לאונבורדינג עם אורית כדי להכין אחת חדשה."
    );
    if (!confirmed) return;

    setRejecting(true);
    try {
      const res = await fetch(`/api/business-profile/reject?brandId=${encodeURIComponent(brandId)}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      router.push(`/${brandId}/onboarding`);
      router.refresh();
    } catch {
      window.alert("הדחייה נכשלה — נסו שוב.");
      setRejecting(false);
    }
  };

  const handleSubmitRevision = async () => {
    if (!revisionNote.trim()) return;
    setRevising(true);
    setRevisionError(null);
    try {
      const res = await fetch(`/api/business-profile/request-revision?brandId=${encodeURIComponent(brandId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: revisionNote }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "העדכון נכשל");
      }
      const updated = await res.json();
      await mutate(updated, { revalidate: false });
      setShowRevisionBox(false);
      setRevisionNote("");
    } catch (e) {
      setRevisionError(e instanceof Error ? e.message : "העדכון נכשל");
    } finally {
      setRevising(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
        <div className="flex gap-2">
          {status === "pending_approval" && (
            <>
              <Button variant="outline" onClick={handleReject} disabled={rejecting || approving || revising}>
                {rejecting ? "דוחה..." : "✕ דחייה"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setShowRevisionBox((v) => !v)}
                disabled={rejecting || approving || revising}
              >
                🔄 בקש שיפורים
              </Button>
              <Button onClick={handleApprove} disabled={approving || rejecting || revising}>
                {approving ? "מאשר..." : "✓ אשר תיק עסק ופתח את הצוותים"}
              </Button>
            </>
          )}
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
      </div>

      {status === "pending_approval" && (
        <p className="text-sm text-muted-foreground -mt-2">
          עברו על התוכן למטה ווידאו שהוא מדויק לפני האישור — לאחר האישור צוותי השיווק והמיתוג ייפתחו לעבודה.
        </p>
      )}

      {showRevisionBox && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3.5">
          <div className="text-sm font-medium">מה כדאי לשנות בתיק העסק?</div>
          <Textarea
            value={revisionNote}
            onChange={(e) => setRevisionNote(e.target.value)}
            placeholder="כתבו כאן בחופשיות מה חסר, מה לא מדויק, או מה צריך להשתנות — בלי הגבלת אורך..."
            className="min-h-32"
            disabled={revising}
          />
          {revisionError && <div className="text-xs text-destructive">{revisionError}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowRevisionBox(false)} disabled={revising}>
              ביטול
            </Button>
            <Button size="sm" onClick={handleSubmitRevision} disabled={revising || !revisionNote.trim()}>
              {revising ? "אורית מעדכנת..." : "עדכון תיק העסק"}
            </Button>
          </div>
        </div>
      )}

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
