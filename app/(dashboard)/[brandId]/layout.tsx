import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { isBrandMember } from "@/lib/db/queries";

/**
 * Tenant-isolation guard for every brand-scoped page: redirects home if the session
 * user isn't authenticated or isn't a member of :brandId, instead of letting the page
 * render (and its data-loading calls potentially leak another brand's data).
 */
export default async function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isBrandMember(brandId, user.id)) redirect("/");

  return <>{children}</>;
}
