import { z } from "zod";
import { NextRequest } from "next/server";
import { readBusinessProfileFull, writeBusinessProfile, isProfileTemplate } from "@/lib/fs/businessProfile";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const profile = await readBusinessProfileFull(brandId!);
  return Response.json({
    content: profile.content,
    isTemplate: isProfileTemplate(profile.content),
    status: profile.status,
    approvedAt: profile.approvedAt,
  });
}

// The minimum number of user turns אוריתה must have exchanged before the resulting profile can
// be saved — a hard, server-side-enforced floor (not just persona instructions the model could
// skip) so a real interview always happens before a fresh onboarding profile goes up for review.
const MIN_ONBOARDING_USER_TURNS = 12;

const UpdateSchema = z.object({
  content: z.string().min(1),
  /** Set when this save comes from אוריתה's onboarding chat rather than a manual edit — gates
   *  the save on `history` actually containing enough user turns. */
  fromOnboarding: z.boolean().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]) })).optional(),
});

export async function PUT(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const body = await req.json().catch(() => null);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  if (parsed.data.fromOnboarding) {
    const userTurns = (parsed.data.history ?? []).filter((m) => m.role === "user").length;
    if (userTurns < MIN_ONBOARDING_USER_TURNS) {
      return Response.json(
        {
          error: `צריך להשלים לפחות ${MIN_ONBOARDING_USER_TURNS} שאלות עם אוריתה לפני שאפשר לשמור את תיק העסק (הושלמו ${userTurns}).`,
        },
        { status: 400 }
      );
    }
  }

  await writeBusinessProfile(brandId!, parsed.data.content);
  const profile = await readBusinessProfileFull(brandId!);
  return Response.json({
    content: profile.content,
    isTemplate: isProfileTemplate(profile.content),
    status: profile.status,
    approvedAt: profile.approvedAt,
  });
}
