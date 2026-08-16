import { NextRequest } from "next/server";
import { approveBusinessProfile, readBusinessProfileFull } from "@/lib/fs/businessProfile";
import { requireBrandMember } from "@/lib/auth/brandAccess";

/** Any brand member (owner or member) can approve — this is a team-wide sign-off that the
 *  profile is ready, not an owner-only permission. Marketing/branding team chats unlock the
 *  moment this succeeds. */
export async function POST(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const approved = approveBusinessProfile(brandId!, guard.user.id);
  if (!approved) {
    return Response.json(
      { error: "אין תיק עסק שממתין לאישור כרגע." },
      { status: 400 }
    );
  }

  const profile = await readBusinessProfileFull(brandId!);
  return Response.json({ status: profile.status, approvedAt: profile.approvedAt });
}
