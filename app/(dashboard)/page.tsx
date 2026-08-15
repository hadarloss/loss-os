import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { listBrandsForUser } from "@/lib/db/queries";
import { BrandPickerClient } from "@/components/brands/BrandPickerClient";

// Reads live DB data — must not be statically cached at build time.
export const dynamic = "force-dynamic";

/**
 * No-brand-selected landing spot: auto-redirects into the single brand a user has,
 * otherwise shows a picker/create-brand prompt (satisfies the "authenticated but no
 * brand selected" case from Phase 1's proxy.ts note without adding brand-selection
 * logic to the proxy itself — this page is the whole "no brand" story).
 */
export default async function RootDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const brands = listBrandsForUser(user.id);
  if (brands.length === 1) {
    redirect(`/${brands[0].id}`);
  }

  return (
    <div className="p-6 max-w-lg mx-auto w-full flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">בחירת מותג</h1>
        <p className="text-muted-foreground mt-1">
          {brands.length === 0
            ? "עדיין אין לכם מותג — צרו אחד כדי להתחיל."
            : "בחרו מותג להמשך העבודה, או צרו מותג נוסף."}
        </p>
      </div>
      <BrandPickerClient brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
