import { NextRequest } from "next/server";
import { getOutputFileById } from "@/lib/fs/outputs";
import { requireBrandMember } from "@/lib/auth/brandAccess";

const CONTENT_TYPES: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  markdown: "text/markdown; charset=utf-8",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");

  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const file = await getOutputFileById(brandId!, id);
  if (!file) return Response.json({ error: "לא נמצא" }, { status: 404 });

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPES[file.format] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(file.filename)}"`,
    },
  });
}
