import { z } from "zod";
import { NextRequest } from "next/server";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { setOutputStatus, addOutputReview, listOutputReviews } from "@/lib/db/queries";

const PatchSchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "קלט לא תקין" }, { status: 400 });
  }

  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  setOutputStatus(id, parsed.data.status);
  addOutputReview({
    outputId: id,
    brandId: brandId!,
    authorUserId: guard.user.id,
    action: parsed.data.status,
  });

  return Response.json({ ok: true, status: parsed.data.status });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  return Response.json({ reviews: listOutputReviews(id) });
}
