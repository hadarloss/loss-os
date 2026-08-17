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

    // Any job still marked 'running' at startup belonged to a stream this process didn't inherit —
    // the request that owned it died with the previous process (redeploy, crash). Nothing else
    // ever settles those rows, so they lingered as permanently "active" work in the sidebar and
    // as stale state that later turns could resurrect.
    const { failStaleRunningJobs } = await import("@/lib/db/queries");
    const reaped = failStaleRunningJobs();
    if (reaped > 0) {
      console.log(`[startup] marked ${reaped} stale running job(s) as failed`);
    }
  }
}
