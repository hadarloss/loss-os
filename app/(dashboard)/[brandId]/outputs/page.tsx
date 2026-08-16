import { OutputsGalleryClient } from "@/components/outputs/OutputsGalleryClient";
import { listOutputs } from "@/lib/fs/outputs";
import { loadAgentRegistry } from "@/lib/agents/registry";

// Reads live data from disk — must not be statically cached at build time.
export const dynamic = "force-dynamic";

export default async function OutputsPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const [outputs, allAgents] = await Promise.all([listOutputs(brandId), loadAgentRegistry()]);
  const specialists = allAgents
    .filter((a) => a.kind === "specialist")
    .map((a) => ({ id: a.id, name: a.name, icon: a.icon, team: a.team }));

  return (
    <div className="p-6 max-w-4xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">📦 תוצרים</h1>
        <p className="text-muted-foreground mt-1">
          תוצרים סופיים שהסוכנים הכינו, לפי סוכן — אשרו, דחו, או בקשו שיפורים ישירות כאן.
        </p>
      </div>
      <OutputsGalleryClient brandId={brandId} outputs={outputs} specialists={specialists} />
    </div>
  );
}
