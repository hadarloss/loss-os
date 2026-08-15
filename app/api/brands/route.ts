import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { createBrand, listBrandsForUser } from "@/lib/db/queries";
import { readBusinessProfile } from "@/lib/fs/businessProfile";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });

  const brands = listBrandsForUser(user.id);
  return NextResponse.json({ brands });
}

const CreateSchema = z.object({ name: z.string().min(1) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "יש להזין שם למותג" }, { status: 400 });
  }

  const brand = createBrand({ name: parsed.data.name, createdBy: user.id });
  // Seeds business_profiles for the new brand from context/BUSINESS_PROFILE.template.md
  // (readBusinessProfile inserts a row from the template the first time it's read).
  await readBusinessProfile(brand.id);

  return NextResponse.json({ brand }, { status: 201 });
}
