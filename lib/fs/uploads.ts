import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { safeJoin, slugify } from "@/lib/fs/paths";
import db from "@/lib/db/schema";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export type UploadKind = "image" | "document";

export interface UploadSummary {
  id: string;
  filename: string;
  kind: UploadKind;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

interface UploadRow {
  id: string;
  brand_id: string;
  user_id: string | null;
  filename: string;
  kind: UploadKind;
  mime_type: string;
  size_bytes: number;
  file_path: string;
  created_at: string;
}

function rowToSummary(row: UploadRow): UploadSummary {
  return {
    id: row.id,
    filename: row.filename,
    kind: row.kind,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
  };
}

/** Persists a base64-encoded chat attachment (image/document only — text attachments are inlined
 *  into the message itself and have no separate file) to disk + an indexed DB row. */
export async function saveUpload(params: {
  brandId: string;
  userId: string | null;
  filename: string;
  kind: UploadKind;
  mimeType: string;
  base64Data: string;
}): Promise<UploadSummary> {
  const dir = safeJoin(UPLOADS_DIR, params.brandId);
  await fs.mkdir(dir, { recursive: true });

  const buffer = Buffer.from(params.base64Data, "base64");
  const id = randomUUID();
  const ext = path.extname(params.filename) || (params.kind === "document" ? ".pdf" : "");
  const storedName = `${id}-${slugify(path.basename(params.filename, ext))}${ext}`;
  const filePath = safeJoin(dir, storedName);
  await fs.writeFile(filePath, buffer);

  db.prepare(
    `INSERT INTO uploads (id, brand_id, user_id, filename, kind, mime_type, size_bytes, file_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.brandId,
    params.userId,
    params.filename,
    params.kind,
    params.mimeType,
    buffer.byteLength,
    `${params.brandId}/${storedName}`
  );

  return {
    id,
    filename: params.filename,
    kind: params.kind,
    mimeType: params.mimeType,
    sizeBytes: buffer.byteLength,
    createdAt: new Date().toISOString(),
  };
}

export async function listUploads(brandId: string): Promise<UploadSummary[]> {
  const rows = db
    .prepare(`SELECT * FROM uploads WHERE brand_id = ? ORDER BY created_at DESC`)
    .all(brandId) as UploadRow[];
  return rows.map(rowToSummary);
}

/** Raw file bytes for a brand-scoped upload by its DB id — tenant isolation boundary: only
 *  serves the file if the row's brand_id matches, so a guessed/leaked id from another brand 404s. */
export async function getUploadFile(
  brandId: string,
  id: string
): Promise<{ filename: string; mimeType: string; buffer: Buffer } | null> {
  const row = db
    .prepare(`SELECT * FROM uploads WHERE brand_id = ? AND id = ?`)
    .get(brandId, id) as UploadRow | undefined;
  if (!row) return null;

  const filePath = safeJoin(UPLOADS_DIR, row.file_path);
  try {
    const buffer = await fs.readFile(filePath);
    return { filename: row.filename, mimeType: row.mime_type, buffer };
  } catch {
    return null;
  }
}
