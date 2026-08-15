import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { getUserByEmail } from "@/lib/db/queries";

const LoginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "יש להזין אימייל וסיסמה" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const user = getUserByEmail(email);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 });
  }

  if (user.status === "pending") {
    return NextResponse.json({ error: "pending", message: "ממתין לאישור מנהל המערכת" }, { status: 403 });
  }
  if (user.status === "rejected") {
    return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, createSessionToken(user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return res;
}
