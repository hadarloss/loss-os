import { randomUUID } from "crypto";
import { z } from "zod";
import { NextRequest } from "next/server";
import { listOutputs, getOutput, saveOutput } from "@/lib/fs/outputs";
import { HandoffRecord, Team } from "@/lib/agents/types";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const brandId = searchParams.get("brandId");
  const team = searchParams.get("team") as Team | null;
  const filename = searchParams.get("filename");

  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  if (filename) {
    if (!team) {
      return Response.json({ error: "team נדרש כשמבקשים filename ספציפי" }, { status: 400 });
    }
    const output = await getOutput(brandId!, team, filename);
    if (!output) return Response.json({ error: "לא נמצא" }, { status: 404 });
    return Response.json(output);
  }

  const outputs = await listOutputs(brandId!, team ?? undefined);
  return Response.json({ outputs });
}

const SaveSchema = z.object({
  brandId: z.string().min(1),
  team: z.enum(["marketing", "branding"]),
  agentId: z.string().min(1),
  content: z.string().min(1),
  deliverableType: z.string().default("general"),
  requestedBy: z.string().default("user"),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const guard = await requireBrandMember(parsed.data.brandId);
  if (guard.response) return guard.response;

  const { brandId, team, agentId, content, deliverableType, requestedBy } = parsed.data;
  const now = new Date().toISOString();
  const handoff: HandoffRecord = {
    task_id: randomUUID(),
    from_agent: requestedBy,
    to_agent: agentId,
    status: "done",
    deliverable_type: deliverableType,
    output_path: null,
    requested_by: requestedBy,
    created_at: now,
    updated_at: now,
    notes: "",
  };

  const { relativePath, format } = await saveOutput({ brandId, team, agentId, content, handoff });
  return Response.json(
    { path: relativePath, format, handoff: { ...handoff, output_path: relativePath, format } },
    { status: 201 }
  );
}
