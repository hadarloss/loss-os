import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth/password";
import { anySuperAdminExists, createUser, getUserByEmail } from "@/lib/db/queries";

const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "הסיסמה חייבת להכיל לפחות 8 תווים"),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "קלט לא תקין" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  if (getUserByEmail(email)) {
    return NextResponse.json({ error: "כבר קיים חשבון עם האימייל הזה" }, { status: 409 });
  }

  // Bootstrap super-admin: the very first signup using SUPER_ADMIN_EMAIL self-approves
  // exactly once (guarded by "no super-admin exists yet"), so Hadar doesn't need a
  // separate seed script — every other signup, including any later reuse of that same
  // email string (impossible anyway since email is UNIQUE and this path only fires
  // once), goes through the normal pending/approval flow below.
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL?.toLowerCase();
  const isBootstrapSuperAdmin =
    !!superAdminEmail && email.toLowerCase() === superAdminEmail && !anySuperAdminExists();

  const user = createUser({
    email,
    passwordHash: hashPassword(password),
    isSuperAdmin: isBootstrapSuperAdmin,
    status: isBootstrapSuperAdmin ? "approved" : "pending",
  });

  return NextResponse.json(
    {
      ok: true,
      status: user.status,
      message:
        user.status === "approved"
          ? "החשבון נוצר ואושר אוטומטית (מנהל מערכת)."
          : "החשבון נוצר, ממתין לאישור מנהל המערכת.",
    },
    { status: 201 }
  );
}
