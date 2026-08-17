/**
 * Next.js calls `register()` exactly once, before the server starts accepting any requests
 * (stable since Next 15 — see https://nextjs.org/docs/app/guides/instrumentation). Importing the
 * DB schema module here forces every migration in lib/db/schema.ts to run and fully commit
 * during startup, closing the race window that used to exist: without this, migrations only ran
 * lazily on whichever request happened to first import something under lib/db/ — meaning a
 * freshly restarted container could already be accepting HTTP traffic while a migration was
 * still catching up, and a request landing in that window could see a half-applied schema
 * ("no such table: agent_jobs_old", from lib/db/schema.ts's agent_jobs rebuild).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/db/schema");
  }
}
