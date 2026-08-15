import { z } from "zod";
import { NextRequest } from "next/server";
import { readBusinessProfile, writeBusinessProfile, isProfileTemplate } from "@/lib/fs/businessProfile";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const content = await readBusinessProfile(brandId!);
  return Response.json({ content, isTemplate: isProfileTemplate(content) });
}

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
  return Response.json({ content: parsed.data.content, isTemplate: isProfileTemplate(parsed.data.content) });
}
