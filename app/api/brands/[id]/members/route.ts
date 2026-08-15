import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { addBrandMember, getUserByEmail, isBrandMember } from "@/lib/db/queries";

const AddMemberSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });

  const { id: brandId } = await params;
  const membership = isBrandMember(brandId, user.id);
  if (!membership || membership.role !== "owner") {
    return NextResponse.json({ error: "רק בעל/ת המותג יכול/ה להוסיף חברים" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = AddMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "יש להזין אימייל תקין" }, { status: 400 });
  }

  const target = getUserByEmail(parsed.data.email);
  if (!target || target.status !== "approved") {
    return NextResponse.json({ error: "לא נמצא משתמש מאושר עם האימייל הזה" }, { status: 400 });
  }

  addBrandMember(brandId, target.id, "member");
  return NextResponse.json({ ok: true }, { status: 201 });
}
