import { NextRequest } from "next/server";
import { listUploads } from "@/lib/fs/uploads";
import { requireBrandMember } from "@/lib/auth/brandAccess";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  const uploads = await listUploads(brandId!);
  return Response.json({ uploads });
}
