import { randomUUID } from "crypto";
import db from "@/lib/db/schema";

export type UserStatus = "pending" | "approved" | "rejected";
export type BrandRole = "owner" | "member";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  is_super_admin: number;
  status: UserStatus;
  created_at: string;
}

export interface BrandRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare(`SELECT * FROM users WHERE lower(email) = lower(?)`)
    .get(email) as UserRow | undefined;
}

export function getUserById(id: string): UserRow | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

export function anySuperAdminExists(): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM users WHERE is_super_admin = 1`)
    .get() as { c: number };
  return row.c > 0;
}

export function createUser(params: {
  email: string;
  passwordHash: string;
  isSuperAdmin: boolean;
  status: UserStatus;
}): UserRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, is_super_admin, status) VALUES (?, ?, ?, ?, ?)`
  ).run(id, params.email, params.passwordHash, params.isSuperAdmin ? 1 : 0, params.status);
  return getUserById(id)!;
}

export function setUserStatus(id: string, status: UserStatus): void {
  db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(status, id);
}

export function updateUserPassword(id: string, passwordHash: string): void {
  db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, id);
}

export function listPendingUsers(): UserRow[] {
  return db
    .prepare(`SELECT * FROM users WHERE status = 'pending' ORDER BY created_at ASC`)
    .all() as UserRow[];
}

export function isBrandMember(brandId: string, userId: string): BrandRow & { role: BrandRole } | undefined {
  return db
    .prepare(
      `SELECT b.*, bm.role as role FROM brand_members bm
       JOIN brands b ON b.id = bm.brand_id
       WHERE bm.brand_id = ? AND bm.user_id = ?`
    )
    .get(brandId, userId) as (BrandRow & { role: BrandRole }) | undefined;
}

export function listBrandsForUser(userId: string): (BrandRow & { role: BrandRole })[] {
  return db
    .prepare(
      `SELECT b.*, bm.role as role FROM brand_members bm
       JOIN brands b ON b.id = bm.brand_id
       WHERE bm.user_id = ?
       ORDER BY b.created_at ASC`
    )
    .all(userId) as (BrandRow & { role: BrandRole })[];
}

export function createBrand(params: { name: string; createdBy: string }): BrandRow {
  const id = randomUUID();
  db.prepare(`INSERT INTO brands (id, name, created_by) VALUES (?, ?, ?)`).run(
    id,
    params.name,
    params.createdBy
  );
  db.prepare(`INSERT INTO brand_members (brand_id, user_id, role) VALUES (?, ?, 'owner')`).run(
    id,
    params.createdBy
  );
  return db.prepare(`SELECT * FROM brands WHERE id = ?`).get(id) as BrandRow;
}

export function addBrandMember(brandId: string, userId: string, role: BrandRole): void {
  db.prepare(
    `INSERT OR IGNORE INTO brand_members (brand_id, user_id, role) VALUES (?, ?, ?)`
  ).run(brandId, userId, role);
}
