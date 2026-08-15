"use client";

import { useState } from "react";
import useSWR from "swr";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { OutputSummary } from "@/lib/fs/outputs";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function OutputsGalleryClient({
  brandId,
  outputs: initialOutputs,
}: {
  brandId: string;
  outputs: OutputSummary[];
}) {
  const { data } = useSWR<{ outputs: OutputSummary[] }>(
    `/api/outputs?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    { fallbackData: { outputs: initialOutputs }, refreshInterval: 7000 }
  );
  const outputs = data?.outputs ?? initialOutputs;

  const marketing = outputs.filter((o) => o.team === "marketing");
  const branding = outputs.filter((o) => o.team === "branding");

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

  return (
    <Tabs defaultValue="marketing">
      <TabsList>
        <TabsTrigger value="marketing">📣 קמפיינים שיווקיים ({marketing.length})</TabsTrigger>
        <TabsTrigger value="branding">🎨 נכסי מיתוג ({branding.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="marketing">
        <OutputGrid items={marketing} onOpen={openOutput} />
      </TabsContent>
      <TabsContent value="branding">
        <OutputGrid items={branding} onOpen={openOutput} />
      </TabsContent>

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
    </Tabs>
  );
}

function OutputGrid({
  items,
  onOpen,
}: {
  items: OutputSummary[];
  onOpen: (output: OutputSummary) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">אין עדיין תוצרים שמורים כאן.</p>;
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3 py-3">
      {items.map((item) => (
        <button key={item.filename} onClick={() => onOpen(item)} className="text-start">
          <Card className="hover:ring-primary/40 transition-shadow hover:shadow-md h-full">
            <CardHeader>
              <CardTitle className="text-sm truncate">
                {item.format === "xlsx" && <span aria-hidden>📊 </span>}
                {item.title}
              </CardTitle>
              <CardDescription>
                {item.agentId} · {item.deliverableType}
              </CardDescription>
            </CardHeader>
          </Card>
        </button>
      ))}
    </div>
  );
}
