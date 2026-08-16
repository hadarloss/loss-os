import { UploadsGalleryClient } from "@/components/uploads/UploadsGalleryClient";
import { listUploads } from "@/lib/fs/uploads";

// Reads live data from disk/DB — must not be statically cached at build time.
export const dynamic = "force-dynamic";

export default async function UploadsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const uploads = await listUploads(brandId);

  return (
    <div className="p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">🖼️ העלאות</h1>
        <p className="text-muted-foreground mt-1">
          כל התמונות והמסמכים שצירפתם לשיחות עם הסוכנים, במקום אחד.
        </p>
      </div>
      <UploadsGalleryClient brandId={brandId} uploads={uploads} />
    </div>
  );
}
