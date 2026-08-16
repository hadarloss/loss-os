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
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'needs_input', 'error')) DEFAULT 'running',
    label TEXT NOT NULL DEFAULT '',
    hop_count INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_brand_members_user ON brand_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_memory_log_brand ON memory_log_entries(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_outputs_brand ON outputs(brand_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_output_reviews_output ON output_reviews(output_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_agent_jobs_brand ON agent_jobs(brand_id, updated_at);
`);

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

export default db;
