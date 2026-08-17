import { NextResponse } from "next/server";
import db from "@/lib/db/client";

// Deliberately public (see proxy.ts's PUBLIC_PATHS) and cheap: Docker's
// HEALTHCHECK and `docker compose up --wait` hit this before any session
// cookie exists, and it needs to prove the DB module (and its startup
// migrations, run via instrumentation.ts) actually finished, not just that
// the HTTP server is listening.
export async function GET() {
  db.prepare("SELECT 1").get();
  return NextResponse.json({ status: "ok" });
}
