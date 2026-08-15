import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/serverSession";
import { getUserById, setUserStatus } from "@/lib/db/queries";

const PatchSchema = z.object({ status: z.enum(["approved", "rejected"]) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !user.is_super_admin) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });
  }

  const target = getUserById(id);
  if (!target) {
    return NextResponse.json({ error: "משתמש לא נמצא" }, { status: 404 });
  }

  setUserStatus(id, parsed.data.status);
  return NextResponse.json({ ok: true });
}
