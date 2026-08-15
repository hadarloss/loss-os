"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function BrandSwitcher({
  brands,
  activeBrandId,
}: {
  brands: { id: string; name: string }[];
  activeBrandId: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  const [newBrandName, setNewBrandName] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === "__new__") {
      setNewBrandOpen(true);
      return;
    }
    // Simplest robust approach: navigate to the new brand's root rather than
    // trying to preserve the current sub-path across brands.
    router.push(`/${value}`);
  };

  const handleCreateBrand = () => {
    const name = newBrandName.trim();
    if (!name) return;
    setCreating(true);
    fetch("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.brand?.id) {
          setNewBrandOpen(false);
          setNewBrandName("");
          router.push(`/${d.brand.id}`);
        }
      })
      .finally(() => setCreating(false));
  };

  if (newBrandOpen) {
    return (
      <div className="flex flex-col gap-1.5 mb-1">
        <input
          autoFocus
          value={newBrandName}
          onChange={(e) => setNewBrandName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateBrand();
            if (e.key === "Escape") setNewBrandOpen(false);
          }}
          placeholder="שם המותג החדש"
          disabled={creating}
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs outline-none"
        />
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={handleCreateBrand}
            disabled={creating || !newBrandName.trim()}
            className="flex-1 rounded-lg bg-primary text-primary-foreground px-2 py-1 text-xs disabled:opacity-50"
          >
            {creating ? "יוצר..." : "יצירה"}
          </button>
          <button
            type="button"
            onClick={() => setNewBrandOpen(false)}
            disabled={creating}
            className="rounded-lg border border-input px-2 py-1 text-xs"
          >
            ביטול
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      value={activeBrandId}
      onChange={handleChange}
      className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-xs outline-none mb-1"
    >
      {brands.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
      <option value="__new__">➕ מותג חדש</option>
    </select>
  );
}
