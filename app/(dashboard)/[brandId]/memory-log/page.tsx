import { MemoryLogClient } from "@/components/memory/MemoryLogClient";
import { listMemoryEntries } from "@/lib/fs/memoryLog";

// Reads live data from disk — must not be statically cached at build time.
export const dynamic = "force-dynamic";

export default async function MemoryLogPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const entries = listMemoryEntries(brandId);

  return (
    <div className="p-6 max-w-3xl mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">🧠 יומן זיכרון דינאמי</h1>
        <p className="text-muted-foreground mt-1">
          כללים, תיקונים והעדפות שנצברו לאורך זמן. כל הסוכנים קוראים את היומן הזה לפני מענה.
        </p>
      </div>

      <MemoryLogClient brandId={brandId} initialEntries={entries} />
    </div>
  );
}
