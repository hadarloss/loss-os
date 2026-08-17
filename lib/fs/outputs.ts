import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { safeJoin, slugify } from "@/lib/fs/paths";
import { HandoffRecord, Team } from "@/lib/agents/types";
import db from "@/lib/db/schema";
import { deleteOutputRow } from "@/lib/db/queries";
import { parseTableFromContent, buildTableWorkbook, isSubstantialTable } from "@/lib/fs/generators/gantt";

/**
 * Whether a deliverable type is schedule/plan shaped and should render as a spreadsheet.
 *
 * Substring matching, not an exact-value set. `deliverable_type` is free text invented by the
 * classifier per turn, so an exact set silently missed real Gantts: a production content calendar
 * came back typed `gantt_content_calendar` and fell through to markdown purely because that
 * string wasn't one of the two literals the old Set contained.
 */
const TABULAR_TYPE_HINTS = ["gantt", "calendar", "schedule", "timeline", "plan", "גאנט", "לוח"];

function looksTabularType(deliverableType: string): boolean {
  const normalized = deliverableType.toLowerCase();
  return TABULAR_TYPE_HINTS.some((hint) => normalized.includes(hint));
}

const OUTPUTS_DIR = path.join(process.cwd(), "outputs");

function folderForTeam(team: Team): "marketing_campaigns" | "brand_assets" {
  return team === "branding" ? "brand_assets" : "marketing_campaigns";
}

export interface OutputFile {
  filename: string;
  team: Team;
  content: string;
  meta: HandoffRecord | null;
}

export interface OutputSummary {
  id: string;
  filename: string;
  team: Team;
  title: string;
  agentId: string;
  deliverableType: string;
  format: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  createdAt: string;
}

interface OutputRow {
  id: string;
  brand_id: string;
  agent_id: string;
  team: Team;
  deliverable_type: string;
  file_path: string;
  format: string;
  status: "pending" | "approved" | "rejected";
  version: number;
  title: string | null;
  created_at: string;
}

function fallbackTitle(content: string): string {
  const firstLine = content
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return "תוצר ללא כותרת";
  return firstLine.replace(/^#+\s*/, "").slice(0, 80);
}

export async function saveOutput(params: {
  brandId: string;
  team: Team;
  agentId: string;
  content: string;
  handoff: HandoffRecord;
  /** Short human-readable title — falls back to the first line of content when omitted
   *  (manual saves that predate the auto-title classifier). */
  title?: string;
}): Promise<{ id: string; relativePath: string; format: "markdown" | "xlsx" }> {
  const folder = folderForTeam(params.team);
  const dir = safeJoin(OUTPUTS_DIR, folder);
  await fs.mkdir(dir, { recursive: true });

  const baseName = `${params.handoff.task_id}-${slugify(params.agentId)}`;
  const title = params.title?.trim() || fallbackTitle(params.content);

  // A deliverable renders to .xlsx when it actually contains a table — either because the type
  // says it's a schedule, or because the table is substantial enough to stand alone as one. Both
  // the markdown table an agent naturally writes and an explicit ```json block are accepted.
  // A parse failure (or anything non-tabular) falls back to markdown so a save never hard-fails.
  const table = parseTableFromContent(params.content);
  if (table && (looksTabularType(params.handoff.deliverable_type) || isSubstantialTable(table))) {
    try {
      const buffer = await buildTableWorkbook(table, title);
      const xlsxPath = safeJoin(dir, `${baseName}.xlsx`);
      const metaPath = safeJoin(dir, `${baseName}.meta.json`);
      const relativePath = `outputs/${folder}/${baseName}.xlsx`;

      const handoffWithPath: HandoffRecord = { ...params.handoff, output_path: relativePath };
      await fs.writeFile(xlsxPath, buffer);
      await fs.writeFile(metaPath, JSON.stringify(handoffWithPath, null, 2), "utf-8");

      const id = randomUUID();
      db.prepare(
        `INSERT INTO outputs (id, brand_id, agent_id, team, deliverable_type, file_path, format, title)
         VALUES (?, ?, ?, ?, ?, ?, 'xlsx', ?)`
      ).run(id, params.brandId, params.agentId, params.team, params.handoff.deliverable_type, `${folder}/${baseName}.xlsx`, title);

      return { id, relativePath, format: "xlsx" };
    } catch (error) {
      // Falling back to markdown is the right behavior — a spreadsheet render failure must not
      // lose the deliverable — but it used to happen with no trace at all, so "the model didn't
      // produce a table" and "exceljs/disk/DB failed" looked identical from the outside.
      console.error(
        `[saveOutput] xlsx render failed for ${params.handoff.deliverable_type}, saving as markdown: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const mdPath = safeJoin(dir, `${baseName}.md`);
  const metaPath = safeJoin(dir, `${baseName}.meta.json`);
  const relativePath = `outputs/${folder}/${baseName}.md`;

  const handoffWithPath: HandoffRecord = { ...params.handoff, output_path: relativePath };
  await fs.writeFile(mdPath, params.content, "utf-8");
  await fs.writeFile(metaPath, JSON.stringify(handoffWithPath, null, 2), "utf-8");

  const id = randomUUID();
  db.prepare(
    `INSERT INTO outputs (id, brand_id, agent_id, team, deliverable_type, file_path, format, title)
     VALUES (?, ?, ?, ?, ?, ?, 'markdown', ?)`
  ).run(
    id,
    params.brandId,
    params.agentId,
    params.team,
    params.handoff.deliverable_type,
    `${folder}/${baseName}.md`,
    title
  );

  return { id, relativePath, format: "markdown" };
}

function rowToSummary(row: OutputRow): OutputSummary {
  const filename = path.basename(row.file_path);
  return {
    id: row.id,
    filename,
    team: row.team,
    title: row.title?.trim() || filename.replace(/\.(md|xlsx)$/, ""),
    agentId: row.agent_id,
    deliverableType: row.deliverable_type,
    format: row.format,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
  };
}

/** Deletes an output's file(s) + DB row (and its review history) entirely — used when a user
 *  rejects a deliverable, which should remove it from the dashboard rather than just flag it. */
export async function deleteOutput(brandId: string, id: string): Promise<boolean> {
  const row = db
    .prepare(`SELECT * FROM outputs WHERE brand_id = ? AND id = ?`)
    .get(brandId, id) as OutputRow | undefined;
  if (!row) return false;

  const filePath = safeJoin(OUTPUTS_DIR, row.file_path);
  const metaPath = filePath.replace(/\.(md|xlsx)$/, ".meta.json");
  await Promise.all([
    fs.unlink(filePath).catch(() => {}),
    fs.unlink(metaPath).catch(() => {}),
  ]);

  deleteOutputRow(id);
  return true;
}

export async function getOutputSummary(brandId: string, id: string): Promise<OutputSummary | null> {
  const row = db
    .prepare(`SELECT * FROM outputs WHERE brand_id = ? AND id = ?`)
    .get(brandId, id) as OutputRow | undefined;
  return row ? rowToSummary(row) : null;
}

export async function listOutputs(brandId: string, team?: Team): Promise<OutputSummary[]> {
  const rows = team
    ? (db
        .prepare(
          `SELECT * FROM outputs WHERE brand_id = ? AND team = ? ORDER BY created_at DESC`
        )
        .all(brandId, team) as OutputRow[])
    : (db
        .prepare(`SELECT * FROM outputs WHERE brand_id = ? ORDER BY created_at DESC`)
        .all(brandId) as OutputRow[]);

  return rows.map(rowToSummary);
}

export async function getOutput(
  brandId: string,
  team: Team,
  filename: string
): Promise<OutputFile | null> {
  const folder = folderForTeam(team);
  const safeName = path.basename(filename); // defense in depth against traversal via filename param

  // Tenant isolation boundary: only serve a file if an outputs row for this brand+team
  // actually indexes it — otherwise a guessed/leaked filename from another brand 404s.
  const row = db
    .prepare(
      `SELECT * FROM outputs WHERE brand_id = ? AND team = ? AND file_path = ?`
    )
    .get(brandId, team, `${folder}/${safeName}`) as OutputRow | undefined;
  if (!row) return null;

  const dir = safeJoin(OUTPUTS_DIR, folder);
  const mdPath = safeJoin(dir, safeName);

  let content: string;
  try {
    content = await fs.readFile(mdPath, "utf-8");
  } catch {
    return null;
  }

  const baseName = safeName.replace(/\.md$/, "");
  const metaPath = safeJoin(dir, `${baseName}.meta.json`);
  let meta: HandoffRecord | null = null;
  try {
    meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
  } catch {
    // no companion metadata
  }

  return { filename: safeName, team, content, meta };
}

/** Raw file bytes for a brand-scoped output by its DB id — used to serve xlsx downloads. */
export async function getOutputFileById(
  brandId: string,
  id: string
): Promise<{ filename: string; format: string; buffer: Buffer } | null> {
  const row = db
    .prepare(`SELECT * FROM outputs WHERE brand_id = ? AND id = ?`)
    .get(brandId, id) as OutputRow | undefined;
  if (!row) return null;

  const filePath = safeJoin(OUTPUTS_DIR, row.file_path);
  try {
    const buffer = await fs.readFile(filePath);
    return { filename: path.basename(row.file_path), format: row.format, buffer };
  } catch {
    return null;
  }
}

export interface OutputForRevision {
  id: string;
  brandId: string;
  agentId: string;
  team: Team;
  deliverableType: string;
  format: string;
  content: string;
}

/** Full row + current text content — used to build a "here's your previous work" revision prompt.
 *  For xlsx outputs there's no meaningful text form to hand back to the model, so this only
 *  supports markdown outputs; callers should check `format` before offering "request changes". */
export async function getOutputForRevision(
  brandId: string,
  id: string
): Promise<OutputForRevision | null> {
  const row = db
    .prepare(`SELECT * FROM outputs WHERE brand_id = ? AND id = ?`)
    .get(brandId, id) as OutputRow | undefined;
  if (!row || row.format !== "markdown") return null;

  const filePath = safeJoin(OUTPUTS_DIR, row.file_path);
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }

  return {
    id: row.id,
    brandId: row.brand_id,
    agentId: row.agent_id,
    team: row.team,
    deliverableType: row.deliverable_type,
    format: row.format,
    content,
  };
}

/** Overwrites a markdown output's file content in place (same path/id) — used after a revision. */
export async function overwriteOutputContent(brandId: string, id: string, newContent: string): Promise<boolean> {
  const row = db
    .prepare(`SELECT * FROM outputs WHERE brand_id = ? AND id = ?`)
    .get(brandId, id) as OutputRow | undefined;
  if (!row || row.format !== "markdown") return false;

  const filePath = safeJoin(OUTPUTS_DIR, row.file_path);
  await fs.writeFile(filePath, newContent, "utf-8");
  return true;
}
