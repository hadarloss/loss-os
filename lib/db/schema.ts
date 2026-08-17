import db from "@/lib/db/client";

/**
 * Idempotent migration, run once at module load. `CREATE TABLE IF NOT EXISTS` keeps
 * this safe to import from anywhere (API routes, scripts) without a separate migration
 * step — good enough at this scale, revisit with a real migration tool if the schema
 * grows much further.
 *
 * IDs are TEXT (crypto.randomUUID()) generated in application code rather than
 * autoincrement, so callers can generate an id before insert and use it consistently
 * across related inserts (e.g. brand id used for both the brands row and the seeded
 * business_profiles row) without needing `lastInsertRowid` round-trips.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_super_admin INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS brands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS brand_members (
    brand_id TEXT NOT NULL REFERENCES brands(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (brand_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS business_profiles (
    brand_id TEXT PRIMARY KEY REFERENCES brands(id),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'template' CHECK (status IN ('template', 'pending_approval', 'approved')),
    approved_at TEXT,
    approved_by TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A file a user attached to a chat message. Chat attachments used to be fully ephemeral
  -- (inlined as base64 into the LLM call and never persisted) — this is the durable record
  -- behind the uploads gallery page. Only image/document attachments are tracked here; plain
  -- text attachments are inlined as text into the message itself with no separate file to keep.
  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id),
    user_id TEXT REFERENCES users(id),
    filename TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'document')),
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS memory_log_entries (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id),
    author_user_id TEXT REFERENCES users(id),
    type TEXT NOT NULL CHECK (type IN ('correction', 'new_rule', 'preference', 'note')),
    agent TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS outputs (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id),
    agent_id TEXT NOT NULL,
    team TEXT NOT NULL,
    deliverable_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'markdown',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS output_reviews (
    id TEXT PRIMARY KEY,
    output_id TEXT NOT NULL REFERENCES outputs(id),
    brand_id TEXT NOT NULL REFERENCES brands(id),
    author_user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL CHECK (action IN ('approved', 'rejected', 'changes_requested')),
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One row per autonomous turn (a user message through however many agent hops it takes) —
  -- lets the dashboard show live per-agent progress without opening the chat itself.
  CREATE TABLE IF NOT EXISTS agent_jobs (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id),
    team TEXT,
    lead_agent_id TEXT,
    current_agent_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'needs_input', 'error', 'plan_pending_approval')) DEFAULT 'running',
    label TEXT NOT NULL DEFAULT '',
    hop_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A lead-proposed multi-agent plan, awaiting user approval before any task executes.
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    brand_id TEXT NOT NULL REFERENCES brands(id),
    job_id TEXT REFERENCES agent_jobs(id),
    team TEXT,
    lead_agent_id TEXT,
    goal TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'running', 'done', 'cancelled')) DEFAULT 'pending_approval',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- One ordered task per agent within a plan. depends_on is a JSON array of plan_task ids,
  -- parsed/serialized in application code (no reliance on SQLite JSON1 functions).
  CREATE TABLE IF NOT EXISTS plan_tasks (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    sequence INTEGER NOT NULL,
    agent_id TEXT NOT NULL,
    deliverable_type TEXT NOT NULL,
    title TEXT NOT NULL,
    brief TEXT NOT NULL DEFAULT '',
    depends_on TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'in_progress', 'done', 'skipped', 'failed')) DEFAULT 'pending',
    output_id TEXT REFERENCES outputs(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_brand_members_user ON brand_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_memory_log_brand ON memory_log_entries(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_outputs_brand ON outputs(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_uploads_brand ON uploads(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_output_reviews_output ON output_reviews(output_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_jobs_brand ON agent_jobs(brand_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_plan_tasks_plan ON plan_tasks(plan_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_plans_job ON plans(job_id);
`);

// Tracks which one-off migrations (the kind that can't be expressed as a plain, always-safe
// `CREATE TABLE IF NOT EXISTS` / `ensureColumn`) have already run — an explicit, indexed record
// instead of re-deriving "did this already happen?" by parsing another table's DDL text on every
// startup. That text-matching approach is what let ensureAgentJobsStatusCheck's rebuild silently
// re-attempt itself under the right conditions; a version table can't misread its own history.
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function migrationApplied(version: string): boolean {
  return !!db.prepare(`SELECT 1 FROM schema_migrations WHERE version = ?`).get(version);
}

function markMigrationApplied(version: string): void {
  db.prepare(`INSERT INTO schema_migrations (version) VALUES (?)`).run(version);
}

// `CREATE TABLE IF NOT EXISTS` doesn't add columns to a table that already exists from before
// this migration — the `outputs` table shipped without status/version/title originally, so add
// them defensively for any pre-existing database file.
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
ensureColumn("outputs", "status", "status TEXT NOT NULL DEFAULT 'pending'");
ensureColumn("outputs", "version", "version INTEGER NOT NULL DEFAULT 1");
ensureColumn("outputs", "title", "title TEXT");
// `status` ships with a CHECK constraint here — SQLite still lets ADD COLUMN attach a fresh
// column-level CHECK to an existing table (unlike altering one on an existing column), so this
// is safe as a plain ensureColumn, no table-rebuild needed like ensureAgentJobsStatusCheck below.
ensureColumn(
  "business_profiles",
  "status",
  "status TEXT NOT NULL DEFAULT 'template' CHECK (status IN ('template', 'pending_approval', 'approved'))"
);
ensureColumn("business_profiles", "approved_at", "approved_at TEXT");
ensureColumn("business_profiles", "approved_by", "approved_by TEXT REFERENCES users(id)");
// A pre-existing profile that already has real content (not the template) predates the status
// column entirely — treat it as already approved rather than forcing every existing brand back
// through onboarding just because this feature shipped later.
db.exec(`
  UPDATE business_profiles SET status = 'approved'
  WHERE status = 'template' AND content NOT LIKE '%_status: template_%'
`);

function tableExists(name: string): boolean {
  return !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
}

// SQLite can't ALTER a CHECK constraint in place — a pre-existing agent_jobs table (created
// before 'plan_pending_approval' was a valid status) needs the whole table rebuilt to accept it.
//
// The rebuild is multiple DDL statements; a process killed mid-way (e.g. a container redeploy
// stopping the old process while this runs) can strand the database with `agent_jobs` renamed to
// `agent_jobs_old` but never recreated — every later query against `agent_jobs` then fails with
// "no such table". Defenses against that: the rebuild runs inside an explicit transaction so a
// kill mid-way rolls back to the pre-migration state instead of leaving it half-applied; the
// migrations table below (not this table's own DDL text) is the source of truth for whether the
// rebuild already happened, so there's no scenario where this re-parses old SQL and decides to
// re-attempt a rebuild that already succeeded; and this whole module now runs once at process
// startup via instrumentation.ts (before the server accepts any requests) rather than lazily on
// whichever request happens to import it first — see instrumentation.ts for why that mattered.
const AGENT_JOBS_STATUS_MIGRATION = "agent_jobs_plan_pending_approval_status";

function ensureAgentJobsStatusCheck(): void {
  // Self-heal a stranded rename from a previous crashed run (predates the migrations-table gate
  // below): `agent_jobs_old` exists (the rename succeeded) but `agent_jobs` doesn't (the recreate
  // step never ran) — restore the original name so the check below can retry the rebuild cleanly.
  if (tableExists("agent_jobs_old") && !tableExists("agent_jobs")) {
    db.exec(`ALTER TABLE agent_jobs_old RENAME TO agent_jobs;`);
  }

  if (migrationApplied(AGENT_JOBS_STATUS_MIGRATION)) return;

  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_jobs'`)
    .get() as { sql: string } | undefined;
  // No table yet, or it already has the right constraint (e.g. a brand-new database, created
  // fresh by the CREATE TABLE IF NOT EXISTS above which already includes 'plan_pending_approval')
  // — nothing to rebuild, just record the migration as done so this check stays a no-op forever.
  if (!row || row.sql.includes("plan_pending_approval")) {
    markMigrationApplied(AGENT_JOBS_STATUS_MIGRATION);
    return;
  }

  db.exec(`
    BEGIN IMMEDIATE;

    ALTER TABLE agent_jobs RENAME TO agent_jobs_old;

    CREATE TABLE agent_jobs (
      id TEXT PRIMARY KEY,
      brand_id TEXT NOT NULL REFERENCES brands(id),
      team TEXT,
      lead_agent_id TEXT,
      current_agent_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running', 'done', 'needs_input', 'error', 'plan_pending_approval')) DEFAULT 'running',
      label TEXT NOT NULL DEFAULT '',
      hop_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT INTO agent_jobs SELECT * FROM agent_jobs_old;
    DROP TABLE agent_jobs_old;

    CREATE INDEX IF NOT EXISTS idx_agent_jobs_brand ON agent_jobs(brand_id, updated_at);

    COMMIT;
  `);
  markMigrationApplied(AGENT_JOBS_STATUS_MIGRATION);
}
ensureAgentJobsStatusCheck();

/**
 * Repairs foreign keys left pointing at `agent_jobs_old` by the rebuild above.
 *
 * This is the actual, long-standing cause of the recurring production error
 * `no such table: main.agent_jobs_old`, and it is not a bug in *when* migrations run — three
 * previous fixes addressed timing and re-entrancy, and none of them could have helped.
 *
 * `ALTER TABLE agent_jobs RENAME TO agent_jobs_old` does not just rename the table: modern SQLite
 * (legacy_alter_table = OFF, the default) also rewrites every reference to it elsewhere in the
 * schema. That silently changed `plans.job_id` from `REFERENCES agent_jobs(id)` to
 * `REFERENCES "agent_jobs_old"(id)`. The migration then created a fresh `agent_jobs` and dropped
 * `agent_jobs_old`, leaving `plans` with a foreign key to a table that no longer exists — a
 * permanent defect baked into the `plans` DDL, entirely independent of the migration that caused
 * it. With `foreign_keys = ON`, every INSERT INTO plans then fails.
 *
 * Which is exactly why only *complex* requests broke: a multi-step plan is the only thing that
 * writes to `plans`. Single-agent requests never touch it and always worked. And it is why
 * inspecting `agent_jobs` (which is genuinely healthy) never revealed anything.
 *
 * The rebuild below runs under `legacy_alter_table = ON` so this RENAME cannot play the same
 * trick on tables that reference `plans` (e.g. plan_tasks.plan_id).
 */
const PLANS_FK_REPAIR_MIGRATION = "plans_job_id_fk_repair";

function ensurePlansForeignKeyIntact(): void {
  if (migrationApplied(PLANS_FK_REPAIR_MIGRATION)) return;

  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'plans'`)
    .get() as { sql: string } | undefined;

  // Nothing to repair on a database whose `plans` table was created after this bug, or that
  // never ran the agent_jobs rebuild at all.
  if (!row || !row.sql.includes("agent_jobs_old")) {
    markMigrationApplied(PLANS_FK_REPAIR_MIGRATION);
    return;
  }

  const foreignKeysWereOn = db.pragma("foreign_keys", { simple: true }) === 1;
  // Both pragmas are no-ops inside a transaction, so they must be set around it, not within.
  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON");
  try {
    db.exec(`
      BEGIN IMMEDIATE;

      ALTER TABLE plans RENAME TO plans_fk_repair_old;

      CREATE TABLE plans (
        id TEXT PRIMARY KEY,
        brand_id TEXT NOT NULL REFERENCES brands(id),
        job_id TEXT REFERENCES agent_jobs(id),
        team TEXT,
        lead_agent_id TEXT,
        goal TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending_approval', 'approved', 'running', 'done', 'cancelled')) DEFAULT 'pending_approval',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO plans SELECT * FROM plans_fk_repair_old;
      DROP TABLE plans_fk_repair_old;

      CREATE INDEX IF NOT EXISTS idx_plans_brand ON plans(brand_id, updated_at);

      COMMIT;
    `);
    markMigrationApplied(PLANS_FK_REPAIR_MIGRATION);
  } finally {
    db.pragma("legacy_alter_table = OFF");
    if (foreignKeysWereOn) db.pragma("foreign_keys = ON");
  }
}
ensurePlansForeignKeyIntact();

/**
 * Fails loudly at startup if any table still references a table that doesn't exist.
 *
 * The dangling-FK defect above survived three rounds of investigation precisely because nothing
 * ever checked for it — the schema looked fine as long as you only inspected the table that had
 * been renamed, and the damage surfaced only as a confusing runtime error on one specific insert.
 * This turns that entire class of problem into a startup log line instead of a mystery.
 */
function warnOnDanglingForeignKeys(): void {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all() as { name: string }[];
  const existing = new Set(tables.map((t) => t.name));

  for (const { name } of tables) {
    const fks = db.pragma(`foreign_key_list(${JSON.stringify(name)})`) as { table: string }[];
    for (const fk of fks) {
      if (!existing.has(fk.table)) {
        console.error(
          `[schema] DANGLING FOREIGN KEY: table "${name}" references missing table "${fk.table}". ` +
            `Writes to "${name}" will fail with "no such table: main.${fk.table}".`
        );
      }
    }
  }
}
warnOnDanglingForeignKeys();

export default db;
