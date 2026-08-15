import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";
import { getUserById, type UserRow } from "@/lib/db/queries";

/** Reads and verifies the session cookie from a server component / route handler, returns the user row or null. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  if (!session) return null;
  return getUserById(session.userId) ?? null;
}
