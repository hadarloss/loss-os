import { randomUUID } from "crypto";
import db from "@/lib/db/schema";

export type MemoryEntryType = "correction" | "new_rule" | "preference" | "note";

export interface MemoryEntry {
  date: string; // ISO-ish, as written
  type: MemoryEntryType;
  agent: string;
  summary: string;
}

interface MemoryRow {
  id: string;
  brand_id: string;
  author_user_id: string | null;
  type: MemoryEntryType;
  agent: string;
  content: string;
  created_at: string;
}

/** DB rows for a brand, newest first — the structured shape the UI/list callers want. */
export function listMemoryEntries(brandId: string): MemoryEntry[] {
  const rows = db
    .prepare(`SELECT * FROM memory_log_entries WHERE brand_id = ? ORDER BY created_at DESC`)
    .all(brandId) as MemoryRow[];

  return rows.map((r) => ({
    date: r.created_at,
    type: r.type,
    agent: r.agent,
    summary: r.content,
  }));
}

/**
 * Renders the DB rows as the same markdown block format the old flat MEMORY_LOG.md used —
 * kept so buildContextBlock() in lib/agents/router.ts (which expects a markdown string
 * appended to an agent's system prompt) needs no signature change.
 */
export async function readMemoryLog(brandId: string): Promise<string> {
  const entries = [...listMemoryEntries(brandId)].reverse(); // oldest first, like the old append-only file
  if (entries.length === 0) return "";

  return entries
    .map((entry) =>
      [
        `## ${entry.date} — ${entry.type}`,
        `**Agent:** ${entry.agent}`,
        `**Type:** ${entry.type}`,
        `**Summary:** ${entry.summary}`,
        "",
        "---",
        "",
      ].join("\n")
    )
    .join("\n");
}

export async function appendMemoryEntry(
  brandId: string,
  entry: { agent: string; type: MemoryEntryType; summary: string; authorUserId?: string }
): Promise<void> {
  db.prepare(
    `INSERT INTO memory_log_entries (id, brand_id, author_user_id, type, agent, content)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), brandId, entry.authorUserId ?? null, entry.type, entry.agent, entry.summary);
}

/** Thin wrapper kept for call sites that still parse a rendered markdown log (legacy shape). */
export function parseMemoryLog(raw: string): MemoryEntry[] {
  const ENTRY_HEADER_RE = /^## (.+?) — (correction|new_rule|preference|note)$/;
  const entries: MemoryEntry[] = [];
  const blocks = raw.split(/\n(?=## )/g);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const headerMatch = lines[0]?.match(ENTRY_HEADER_RE);
    if (!headerMatch) continue;

    const [, date, type] = headerMatch;
    const agentLine = lines.find((l) => l.startsWith("**Agent:**"));
    const summaryLine = lines.find((l) => l.startsWith("**Summary:**"));

    entries.push({
      date,
      type: type as MemoryEntryType,
      agent: agentLine?.replace("**Agent:**", "").trim() ?? "",
      summary: summaryLine?.replace("**Summary:**", "").trim() ?? "",
    });
  }

  return entries.reverse(); // newest first for the viewer
}
