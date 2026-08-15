"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function BrandPickerClient({ brands }: { brands: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "שגיאה ביצירת המותג");
      router.push(`/${data.brand.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה ביצירת המותג");
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {brands.length > 0 && (
        <div className="grid gap-3">
          {brands.map((b) => (
            <Link key={b.id} href={`/${b.id}`}>
              <Card className="hover:ring-primary/40 transition-shadow hover:shadow-md">
                <CardHeader>
                  <CardTitle className="text-base">{b.name}</CardTitle>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="text-sm font-medium">מותג חדש +</div>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="שם המותג/העסק"
              className="flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <Button onClick={handleCreate} disabled={creating || !name.trim()}>
              {creating ? "יוצר..." : "יצירה"}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
