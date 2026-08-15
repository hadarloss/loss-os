import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { updateUserPassword } from "@/lib/db/queries";

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, "הסיסמה החדשה חייבת להכיל לפחות 8 תווים"),
});

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = ChangePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "קלט לא תקין" }, { status: 400 });
  }

  if (!verifyPassword(parsed.data.currentPassword, user.password_hash)) {
    return NextResponse.json({ error: "הסיסמה הנוכחית שגויה" }, { status: 403 });
  }

  updateUserPassword(user.id, hashPassword(parsed.data.newPassword));
  return NextResponse.json({ ok: true });
}
