import path from "path";
import { promises as fsp } from "fs";
import fs from "fs";
import Database from "better-sqlite3";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "app.db");

function ensureDataDirSync(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// Best-effort async variant kept for symmetry with the rest of lib/fs — not required
// on the hot path since ensureDataDirSync already runs at module load below.
export async function ensureDataDir(): Promise<void> {
  await fsp.mkdir(DATA_DIR, { recursive: true });
}

ensureDataDirSync();

/**
 * Singleton better-sqlite3 connection. better-sqlite3 is synchronous by design —
 * there is no async client to await, the module load itself opens/creates the file.
 */
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
// A container redeploy briefly overlaps the outgoing and incoming process on the same WAL file
// (old container still shutting down while the new one's migrations run) — without a busy
// timeout, better-sqlite3 throws SQLITE_BUSY immediately instead of waiting the lock out.
db.pragma("busy_timeout = 5000");

export default db;
