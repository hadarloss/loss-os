import { NextRequest } from "next/server";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { getPlan } from "@/lib/db/queries";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const plan = getPlan(id);
  if (!plan || plan.brandId !== brandId) {
    return Response.json({ error: "תוכנית לא נמצאה" }, { status: 404 });
  }

  return Response.json({ plan });
}
