import { z } from "zod";
import { NextRequest } from "next/server";
import { readBusinessProfileFull, writeBusinessProfile, isProfileTemplate } from "@/lib/fs/businessProfile";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const profile = await readBusinessProfileFull(brandId!);
  return Response.json({
    content: profile.content,
    isTemplate: isProfileTemplate(profile.content),
    status: profile.status,
    approvedAt: profile.approvedAt,
  });
}

// Manual edits only — the onboarding wizard doesn't use this endpoint at all, it goes through
// /api/business-profile/complete-onboarding (initial draft) and /request-revision (revision
// rounds), both of which run אורית and enforce their own preconditions before writing.
const UpdateSchema = z.object({ content: z.string().min(1) });

export async function PUT(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  await writeBusinessProfile(brandId!, parsed.data.content);
  const profile = await readBusinessProfileFull(brandId!);
  return Response.json({
    content: profile.content,
    isTemplate: isProfileTemplate(profile.content),
    status: profile.status,
    approvedAt: profile.approvedAt,
  });
}
