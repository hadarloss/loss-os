import { NextRequest } from "next/server";
import { requireBrandMember } from "@/lib/auth/brandAccess";
import { listRecentAgentJobs } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const brandId = req.nextUrl.searchParams.get("brandId");
  const guard = await requireBrandMember(brandId);
  if (guard.response) return guard.response;

  return Response.json({ jobs: listRecentAgentJobs(brandId!) });
}
