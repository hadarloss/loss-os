import { promises as fs } from "fs";
import path from "path";
import db from "@/lib/db/schema";

const TEMPLATE_PATH = path.join(process.cwd(), "context", "BUSINESS_PROFILE.template.md");

interface ProfileRow {
  brand_id: string;
  content: string;
  updated_at: string;
}

async function readTemplate(): Promise<string> {
  return fs.readFile(TEMPLATE_PATH, "utf-8");
}

/** DB-backed equivalent of the old ensureSeededFromTemplate — seeds a brand's row once. */
async function ensureSeeded(brandId: string): Promise<ProfileRow> {
  const existing = db
    .prepare(`SELECT * FROM business_profiles WHERE brand_id = ?`)
    .get(brandId) as ProfileRow | undefined;
  if (existing) return existing;

  const template = await readTemplate();
  db.prepare(
    `INSERT INTO business_profiles (brand_id, content) VALUES (?, ?)
     ON CONFLICT(brand_id) DO NOTHING`
  ).run(brandId, template);
  return db.prepare(`SELECT * FROM business_profiles WHERE brand_id = ?`).get(brandId) as ProfileRow;
}

export async function readBusinessProfile(brandId: string): Promise<string> {
  const row = await ensureSeeded(brandId);
  return row.content;
}

/** Full-document overwrite — the profile is a structured doc the user/onboarding agent rewrites wholesale. */
export async function writeBusinessProfile(brandId: string, markdown: string): Promise<void> {
  db.prepare(
    `INSERT INTO business_profiles (brand_id, content, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(brand_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`
  ).run(brandId, markdown);
}

/** True while the profile is still the unfilled template shipped with the repo. */
export function isProfileTemplate(content: string): boolean {
  return content.includes("_status: template_");
}
