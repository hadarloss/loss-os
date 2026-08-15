import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { isBrandMember } from "@/lib/db/queries";
import type { UserRow } from "@/lib/db/queries";

/**
 * Shared tenant-isolation guard for brand-scoped API routes: verifies the caller is
 * authenticated AND a member (owner or member) of the given brandId. Returns either
 * `{ user }` to proceed, or `{ response }` — an already-built 401/403 NextResponse
 * the route handler should return as-is.
 */
export async function requireBrandMember(
  brandId: string | null | undefined
): Promise<{ user: UserRow; response?: undefined } | { user?: undefined; response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 }) };
  }
  if (!brandId) {
    return { response: NextResponse.json({ error: "brandId נדרש" }, { status: 400 }) };
  }
  if (!isBrandMember(brandId, user.id)) {
    return { response: NextResponse.json({ error: "אין הרשאה למותג זה" }, { status: 403 }) };
  }
  return { user };
}
