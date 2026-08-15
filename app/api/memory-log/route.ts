import { z } from "zod";
import { NextRequest } from "next/server";
import { readMemoryLog, appendMemoryEntry, listMemoryEntries } from "@/lib/fs/memoryLog";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const raw = await readMemoryLog(brandId!);
  return Response.json({ raw, entries: listMemoryEntries(brandId!) });
}

const AppendSchema = z.object({
  brandId: z.string().min(1),
  agent: z.string().min(1),
  type: z.enum(["correction", "new_rule", "preference", "note"]),
  summary: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = AppendSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const guard = await requireBrandMember(parsed.data.brandId);
  if (guard.response) return guard.response;

  await appendMemoryEntry(parsed.data.brandId, {
    agent: parsed.data.agent,
    type: parsed.data.type,
    summary: parsed.data.summary,
    authorUserId: guard.user.id,
  });
  const raw = await readMemoryLog(parsed.data.brandId);
  return Response.json({ raw, entries: listMemoryEntries(parsed.data.brandId) }, { status: 201 });
}
