import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { getUserById, type UserRow } from "@/lib/db/queries";

/**
 * Reads and verifies the session cookie from a server component / route handler, returns the user
 * row or null.
 *
 * Re-checks `status` on every request, not just at login. The cookie is a signed 30-day bearer
 * token with no server-side revocation, so without this an account rejected or banned at
 * /admin/users kept full access — including to every brand-scoped API — until the token expired
 * on its own, which defeats the point of the manual-approval model.
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  if (!session) return null;
  const user = getUserById(session.userId);
  if (!user || user.status !== "approved") return null;
  return user;
}
