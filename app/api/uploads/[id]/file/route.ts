import { NextRequest } from "next/server";
import { getUploadFile } from "@/lib/fs/uploads";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brandId = req.nextUrl.searchParams.get("brandId");

  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const file = await getUploadFile(brandId!, id);
  if (!file) return Response.json({ error: "לא נמצא" }, { status: 404 });

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.filename)}"`,
    },
  });
}
