import { NextRequest } from "next/server";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { getPlan, updatePlanStatus, updateAgentJob } from "@/lib/db/queries";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const plan = getPlan(id);
  if (!plan || plan.brandId !== brandId) {
    return Response.json({ error: "תוכנית לא נמצאה" }, { status: 404 });
  }
  if (plan.status !== "pending_approval") {
    return Response.json({ error: "אי אפשר לבטל תוכנית שכבר אושרה או הסתיימה" }, { status: 409 });
  }

  updatePlanStatus(id, "cancelled");
  if (plan.jobId) {
    updateAgentJob(plan.jobId, { status: "done", label: "התוכנית בוטלה" });
  }

  return Response.json({ ok: true, status: "cancelled" });
}
