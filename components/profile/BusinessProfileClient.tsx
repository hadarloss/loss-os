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
      "לדחות את תיק העסק? הטיוטה תימחק ותחזרו לשיחה עם אוריתה כדי להכין אחת חדשה."
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
        <div className="flex gap-2">
          {status === "pending_approval" && (
            <>
              <Button variant="outline" onClick={handleReject} disabled={rejecting || approving}>
                {rejecting ? "דוחה..." : "✕ דחייה"}
              </Button>
              <Button onClick={handleApprove} disabled={approving || rejecting}>
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
