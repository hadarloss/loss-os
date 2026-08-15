"use client";

import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AddMemoryEntryForm } from "@/components/memory/AddMemoryEntryForm";
import type { MemoryEntry, MemoryEntryType } from "@/lib/fs/memoryLog";

const TYPE_LABELS: Record<MemoryEntryType, string> = {
  correction: "תיקון",
  new_rule: "כלל חדש",
  preference: "העדפה",
  note: "הערה",
};

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function MemoryLogClient({
  brandId,
  initialEntries,
}: {
  brandId: string;
  initialEntries: MemoryEntry[];
}) {
  const { data, mutate } = useSWR<{ entries: MemoryEntry[] }>(
    `/api/memory-log?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    { fallbackData: { entries: initialEntries }, refreshInterval: 7000 }
  );
  const entries = data?.entries ?? initialEntries;

  return (
    <>
      <AddMemoryEntryForm brandId={brandId} onSaved={() => mutate()} />

      <div className="flex flex-col gap-3">
        {entries.length === 0 && (
          <p className="text-sm text-muted-foreground">אין עדיין רשומות ביומן.</p>
        )}
        {entries.map((entry, i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Badge variant="secondary">{TYPE_LABELS[entry.type]}</Badge>
                <span className="text-xs text-muted-foreground">{entry.date}</span>
              </div>
              <p className="text-sm">{entry.summary}</p>
              <p className="text-xs text-muted-foreground">מקור: {entry.agent}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
