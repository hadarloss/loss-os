import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { safeJoin, slugify } from "@/lib/fs/paths";
import { HandoffRecord, Team } from "@/lib/agents/types";
import db from "@/lib/db/schema";
import { parseGanttFromContent, buildGanttWorkbook } from "@/lib/fs/generators/gantt";

/** deliverable_type values that should attempt an xlsx Gantt render before falling back to markdown. */
const GANTT_DELIVERABLE_TYPES = new Set(["gantt", "content_calendar"]);

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
  created_at: string;
}

export async function saveOutput(params: {
  brandId: string;
  team: Team;
  agentId: string;
  content: string;
  handoff: HandoffRecord;
}): Promise<{ relativePath: string; format: "markdown" | "xlsx" }> {
  const folder = folderForTeam(params.team);
  const dir = safeJoin(OUTPUTS_DIR, folder);
  await fs.mkdir(dir, { recursive: true });

  const baseName = `${params.handoff.task_id}-${slugify(params.agentId)}`;

  // Gantt-shaped deliverables render to .xlsx when the content contains a parseable
  // fenced ```json task list; anything else (or a parse failure) falls back to plain
  // markdown so a save never hard-fails.
  if (GANTT_DELIVERABLE_TYPES.has(params.handoff.deliverable_type)) {
    const tasks = parseGanttFromContent(params.content);
    if (tasks) {
      try {
        const buffer = await buildGanttWorkbook(tasks);
        const xlsxPath = safeJoin(dir, `${baseName}.xlsx`);
        const metaPath = safeJoin(dir, `${baseName}.meta.json`);
        const relativePath = `outputs/${folder}/${baseName}.xlsx`;

        const handoffWithPath: HandoffRecord = { ...params.handoff, output_path: relativePath };
        await fs.writeFile(xlsxPath, buffer);
        await fs.writeFile(metaPath, JSON.stringify(handoffWithPath, null, 2), "utf-8");

        const id = randomUUID();
        db.prepare(
          `INSERT INTO outputs (id, brand_id, agent_id, team, deliverable_type, file_path, format)
           VALUES (?, ?, ?, ?, ?, ?, 'xlsx')`
        ).run(id, params.brandId, params.agentId, params.team, params.handoff.deliverable_type, `${folder}/${baseName}.xlsx`);

        return { relativePath, format: "xlsx" };
      } catch {
        // fall through to markdown save below
      }
    }
  }

  const mdPath = safeJoin(dir, `${baseName}.md`);
  const metaPath = safeJoin(dir, `${baseName}.meta.json`);
  const relativePath = `outputs/${folder}/${baseName}.md`;

  const handoffWithPath: HandoffRecord = { ...params.handoff, output_path: relativePath };
  await fs.writeFile(mdPath, params.content, "utf-8");
  await fs.writeFile(metaPath, JSON.stringify(handoffWithPath, null, 2), "utf-8");

  db.prepare(
    `INSERT INTO outputs (id, brand_id, agent_id, team, deliverable_type, file_path, format)
     VALUES (?, ?, ?, ?, ?, ?, 'markdown')`
  ).run(
    randomUUID(),
    params.brandId,
    params.agentId,
    params.team,
    params.handoff.deliverable_type,
    `${folder}/${baseName}.md`
  );

  return { relativePath, format: "markdown" };
}

function rowToSummary(row: OutputRow): OutputSummary {
  const filename = path.basename(row.file_path);
  return {
    id: row.id,
    filename,
    team: row.team,
    title: filename.replace(/\.(md|xlsx)$/, ""),
    agentId: row.agent_id,
    deliverableType: row.deliverable_type,
    format: row.format,
    createdAt: row.created_at,
  };
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
