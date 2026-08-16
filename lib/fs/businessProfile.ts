import { promises as fs } from "fs";
import path from "path";
import db from "@/lib/db/schema";

const TEMPLATE_PATH = path.join(process.cwd(), "context", "BUSINESS_PROFILE.template.md");

export type ProfileStatus = "template" | "pending_approval" | "approved";

interface ProfileRow {
  brand_id: string;
  content: string;
  status: ProfileStatus;
  approved_at: string | null;
  approved_by: string | null;
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

export async function getBusinessProfileStatus(brandId: string): Promise<ProfileStatus> {
  const row = await ensureSeeded(brandId);
  return row.status;
}

export interface BusinessProfileFull {
  content: string;
  status: ProfileStatus;
  approvedAt: string | null;
}

export async function readBusinessProfileFull(brandId: string): Promise<BusinessProfileFull> {
  const row = await ensureSeeded(brandId);
  return { content: row.content, status: row.status, approvedAt: row.approved_at };
}

/**
 * Full-document overwrite — the profile is a structured doc the user/onboarding agent rewrites
 * wholesale. Status transitions: writing the template content always resets to `template`;
 * writing real content from a `template` state (first-ever onboarding, or after a reset) moves
 * to `pending_approval` so the user must explicitly confirm it on the business-profile page
 * before team chats unlock; writing real content when already `pending_approval`/`approved`
 * leaves the status as-is (a normal manual edit doesn't re-trigger the approval gate — only the
 * reset flow does).
 */
export async function writeBusinessProfile(brandId: string, markdown: string): Promise<void> {
  const current = await ensureSeeded(brandId);
  const nextStatus: ProfileStatus = isProfileTemplate(markdown)
    ? "template"
    : current.status === "template"
      ? "pending_approval"
      : current.status;

  db.prepare(
    `UPDATE business_profiles
     SET content = ?, status = ?, updated_at = datetime('now')
     WHERE brand_id = ?`
  ).run(markdown, nextStatus, brandId);
}

/** Approves a profile that's awaiting review — no-op (returns false) if it isn't currently
 *  `pending_approval`, so an approve click can't silently "approve" a stale/already-approved page. */
export function approveBusinessProfile(brandId: string, userId: string): boolean {
  const result = db
    .prepare(
      `UPDATE business_profiles
       SET status = 'approved', approved_at = datetime('now'), approved_by = ?
       WHERE brand_id = ? AND status = 'pending_approval'`
    )
    .run(userId, brandId);
  return result.changes > 0;
}

/** Rejects a profile that's awaiting review — sends it back to `template` so the user can redo
 *  onboarding with אוריתה, instead of approving a draft they don't want live. No-op (returns
 *  false) if it isn't currently `pending_approval`, matching approveBusinessProfile's guard. */
export async function rejectPendingBusinessProfile(brandId: string): Promise<boolean> {
  const current = await ensureSeeded(brandId);
  if (current.status !== "pending_approval") return false;
  await resetBusinessProfile(brandId);
  return true;
}

/** Wipes the business profile back to the unfilled template and clears its approval state —
 *  used by the home page's "reset" action. Does not touch memory log entries or outputs; callers
 *  that want those cleared too (e.g. the reset endpoint) do it separately. */
export async function resetBusinessProfile(brandId: string): Promise<void> {
  await ensureSeeded(brandId);
  const template = await readTemplate();
  db.prepare(
    `UPDATE business_profiles
     SET content = ?, status = 'template', approved_at = NULL, approved_by = NULL, updated_at = datetime('now')
     WHERE brand_id = ?`
  ).run(template, brandId);
}

/** True while the profile is still the unfilled template shipped with the repo. */
export function isProfileTemplate(content: string): boolean {
  return content.includes("_status: template_");
}
