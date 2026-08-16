"use client";

import useSWR from "swr";
import { Card, CardContent } from "@/components/ui/card";
import type { UploadSummary } from "@/lib/fs/uploads";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function UploadsGalleryClient({
  brandId,
  uploads: initialUploads,
}: {
  brandId: string;
  uploads: UploadSummary[];
}) {
  const { data } = useSWR<{ uploads: UploadSummary[] }>(
    `/api/uploads?brandId=${encodeURIComponent(brandId)}`,
    fetcher,
    { fallbackData: { uploads: initialUploads }, refreshInterval: 10000 }
  );
  const uploads = data?.uploads ?? initialUploads;

  if (uploads.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          עדיין לא הועלו קבצים. תמונות ומסמכי PDF שמצורפים לצ׳אט עם סוכן יופיעו כאן אוטומטית.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {uploads.map((u) => {
        const fileUrl = `/api/uploads/${u.id}/file?brandId=${encodeURIComponent(brandId)}`;
        return (
          <a key={u.id} href={fileUrl} target="_blank" rel="noreferrer" className="block">
            <Card className="overflow-hidden hover:ring-primary/40 transition-shadow hover:shadow-md">
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                {u.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={fileUrl} alt={u.filename} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl" aria-hidden>
                    📕
                  </span>
                )}
              </div>
              <CardContent className="p-2.5">
                <div className="text-xs font-medium truncate" title={u.filename}>
                  {u.filename}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {formatSize(u.sizeBytes)} · {formatDate(u.createdAt)}
                </div>
              </CardContent>
            </Card>
          </a>
        );
      })}
    </div>
  );
}
