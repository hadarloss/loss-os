import { OutputsGalleryClient } from "@/components/outputs/OutputsGalleryClient";
import { listOutputs } from "@/lib/fs/outputs";

// Reads live data from disk — must not be statically cached at build time.
export const dynamic = "force-dynamic";

export default async function OutputsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const outputs = await listOutputs(brandId);

  return (
    <div className="p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">📦 תוצרים</h1>
        <p className="text-muted-foreground mt-1">
          קמפיינים שיווקיים ונכסי מיתוג ששמרתם מתוך שיחות עם הסוכנים.
        </p>
      </div>
      <OutputsGalleryClient brandId={brandId} outputs={outputs} />
    </div>
  );
}
