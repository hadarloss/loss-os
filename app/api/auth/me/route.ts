import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "נדרשת התחברות" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    email: user.email,
    isSuperAdmin: !!user.is_super_admin,
  });
}
