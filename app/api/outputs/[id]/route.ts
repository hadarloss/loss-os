import { z } from "zod";
import { NextRequest } from "next/server";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { setOutputStatus, addOutputReview, listOutputReviews } from "@/lib/db/queries";
import { deleteOutput, getOutputSummary } from "@/lib/fs/outputs";
import { appendMemoryEntry } from "@/lib/fs/memoryLog";

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

  // Rejecting removes the deliverable entirely — the dashboard is for usable final work, not a
  // graveyard of rejected drafts — so there's nothing to log a review against afterward.
  if (parsed.data.status === "rejected") {
    const deleted = await deleteOutput(brandId!, id);
    if (!deleted) return Response.json({ error: "לא נמצא" }, { status: 404 });
    return Response.json({ ok: true, deleted: true });
  }

  setOutputStatus(id, "approved");
  addOutputReview({
    outputId: id,
    brandId: brandId!,
    authorUserId: guard.user.id,
    action: "approved",
  });

  // Approval isn't just a status flag — it feeds back into the shared memory log so future
  // replies from this (and other) agents are reinforced by what the user actually confirmed as
  // good work, the same way a manual "preference" memory note would.
  const output = await getOutputSummary(brandId!, id);
  if (output) {
    await appendMemoryEntry(brandId!, {
      agent: output.agentId,
      type: "preference",
      summary: `התוצר "${output.title}" (${output.deliverableType}) אושר על ידי המשתמש — הסגנון והגישה בו נחשבים לדוגמה טובה להמשך.`,
      authorUserId: guard.user.id,
    });
  }

  return Response.json({ ok: true, status: "approved" });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  return Response.json({ reviews: listOutputReviews(id) });
}
