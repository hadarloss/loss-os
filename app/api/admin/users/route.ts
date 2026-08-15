import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { listPendingUsers } from "@/lib/db/queries";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const pending = listPendingUsers().map((u) => ({ id: u.id, email: u.email, createdAt: u.created_at }));
  return NextResponse.json({ pending });
}
