import { NextRequest } from "next/server";
import { resetBusinessProfile } from "@/lib/fs/businessProfile";
import { clearMemoryLog } from "@/lib/fs/memoryLog";
import { requireBrandMember } from "@/lib/auth/brandAccess";

/**
 * Wipes the business profile back to the unfilled template and clears the memory log — the
 * explicit-confirmation "reset" action on the home page. Deliberately does NOT touch outputs
 * (saved deliverables) or agent personas/skills, only the two stores that make up what the
 * agents currently know about this specific business. Marketing/branding team chats lock again
 * immediately (business_profiles.status drops to 'template'), until a fresh onboarding interview
 * with אורית is completed and reviewed on the business-profile page.
 */
export async function POST(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  await resetBusinessProfile(brandId!);
  clearMemoryLog(brandId!);

  return Response.json({ ok: true });
}
