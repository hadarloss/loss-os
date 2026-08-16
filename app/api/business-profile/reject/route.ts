import { NextRequest } from "next/server";
import { rejectPendingBusinessProfile } from "@/lib/fs/businessProfile";
import { requireBrandMember } from "@/lib/auth/brandAccess";

/** Rejects a profile awaiting review, sending it back to `template` so the user can redo
 *  onboarding — does not clear the memory log (unlike the full reset), since a rejected draft
 *  from a first onboarding attempt hasn't accumulated any memory-log entries of its own. */
export async function POST(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const rejected = await rejectPendingBusinessProfile(brandId!);
  if (!rejected) {
    return Response.json({ error: "אין תיק עסק שממתין לאישור כרגע." }, { status: 400 });
  }

  return Response.json({ ok: true });
}
