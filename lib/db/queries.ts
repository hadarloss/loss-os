import { randomUUID } from "crypto";
import db from "@/lib/db/schema";
import type { Plan, PlanTask, PlanStatus, PlanTaskStatus } from "@/lib/agents/types";

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

export type OutputStatus = "pending" | "approved" | "rejected";
export type OutputReviewAction = "approved" | "rejected" | "changes_requested";

export interface OutputReviewRow {
  id: string;
  output_id: string;
  brand_id: string;
  author_user_id: string | null;
  action: OutputReviewAction;
  note: string | null;
  created_at: string;
}

/** Brand-scoped deliberately: `brandId` comes from the caller's verified membership, `id` from the
 *  URL. Without the `brand_id` predicate a member of one brand could flip the approval status of
 *  another brand's deliverable just by knowing (or guessing) its id. Returns false when the row
 *  isn't this brand's, so the route can 404 rather than silently no-op. */
export function setOutputStatus(brandId: string, id: string, status: OutputStatus): boolean {
  return (
    db
      .prepare(`UPDATE outputs SET status = ? WHERE id = ? AND brand_id = ?`)
      .run(status, id, brandId).changes > 0
  );
}

/** Returns the new version number. */
export function bumpOutputVersion(id: string): number {
  db.prepare(`UPDATE outputs SET version = version + 1 WHERE id = ?`).run(id);
  const row = db.prepare(`SELECT version FROM outputs WHERE id = ?`).get(id) as { version: number };
  return row.version;
}

export function addOutputReview(params: {
  outputId: string;
  brandId: string;
  authorUserId?: string;
  action: OutputReviewAction;
  note?: string;
}): void {
  db.prepare(
    `INSERT INTO output_reviews (id, output_id, brand_id, author_user_id, action, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    randomUUID(),
    params.outputId,
    params.brandId,
    params.authorUserId ?? null,
    params.action,
    params.note ?? null
  );
}

/** Brand-scoped for the same reason as setOutputStatus — review notes carry business feedback and
 *  must never be readable across tenants on a guessed output id. */
export function listOutputReviews(brandId: string, outputId: string): OutputReviewRow[] {
  return db
    .prepare(
      `SELECT * FROM output_reviews WHERE output_id = ? AND brand_id = ? ORDER BY created_at ASC`
    )
    .all(outputId, brandId) as OutputReviewRow[];
}

export function deleteOutputRow(id: string): void {
  db.prepare(`DELETE FROM output_reviews WHERE output_id = ?`).run(id);
  db.prepare(`DELETE FROM outputs WHERE id = ?`).run(id);
}

export type AgentJobStatus = "running" | "done" | "needs_input" | "error" | "plan_pending_approval";

export interface AgentJobRow {
  id: string;
  brand_id: string;
  team: string | null;
  lead_agent_id: string | null;
  current_agent_id: string;
  status: AgentJobStatus;
  label: string;
  hop_count: number;
  started_at: string;
  updated_at: string;
}

export function createAgentJob(params: {
  brandId: string;
  team?: string;
  leadAgentId?: string;
  currentAgentId: string;
  label?: string;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_jobs (id, brand_id, team, lead_agent_id, current_agent_id, label)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.brandId,
    params.team ?? null,
    params.leadAgentId ?? null,
    params.currentAgentId,
    params.label ?? ""
  );
  return id;
}

export function updateAgentJob(
  id: string,
  patch: { currentAgentId?: string; status?: AgentJobStatus; label?: string; hopCount?: number }
): void {
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];
  if (patch.currentAgentId !== undefined) {
    sets.push("current_agent_id = ?");
    values.push(patch.currentAgentId);
  }
  if (patch.status !== undefined) {
    sets.push("status = ?");
    values.push(patch.status);
  }
  if (patch.label !== undefined) {
    sets.push("label = ?");
    values.push(patch.label);
  }
  if (patch.hopCount !== undefined) {
    sets.push("hop_count = ?");
    values.push(patch.hopCount);
  }
  values.push(id);
  db.prepare(`UPDATE agent_jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** How long a job stays eligible to be resumed by the user's next message, and how long a
 *  `running` row is still believed to belong to a live stream. Anything older is stale: a process
 *  restart or a closed tab leaves rows behind with no one left to finish them, and resurrecting
 *  those is what produced the "an old agent came back / that agent no longer exists" errors. */
const JOB_STALE_AFTER = "-30 minutes";

/** Running jobs, plus recently-finished ones (last 5 minutes) so a completed/blocked job doesn't
 *  just vanish from the dashboard the instant it's done — the user can see it settled.
 *  `running` rows are age-bounded too: without that, a job orphaned by a redeploy or a closed tab
 *  showed as permanently "active" in the sidebar with an ever-growing elapsed timer. */
export function listRecentAgentJobs(brandId: string): AgentJobRow[] {
  return db
    .prepare(
      `SELECT * FROM agent_jobs
       WHERE brand_id = ?
         AND ((status = 'running' AND updated_at >= datetime('now', ?))
              OR updated_at >= datetime('now', '-5 minutes'))
       ORDER BY updated_at DESC`
    )
    .all(brandId, JOB_STALE_AFTER) as AgentJobRow[];
}

/** The most recent job left waiting on the user for this brand+team, if any — the chat route
 *  checks this before starting a fresh turn so answering a clarifying question (or unblocking a
 *  paused plan task) continues the same job/plan instead of abandoning it for an unrelated one.
 *
 *  Age-bounded deliberately: this used to match a `needs_input` job of any age, so a days-old
 *  paused task would silently hijack a brand-new, unrelated request — announcing itself as
 *  "continuing a plan that was waiting for your answer", and erroring outright when that old plan
 *  referenced an agent id that no longer exists under skills/. A resume only makes sense while the
 *  user still has the previous exchange in mind. */
export function getResumableJob(brandId: string, team: string): AgentJobRow | undefined {
  return db
    .prepare(
      `SELECT * FROM agent_jobs WHERE brand_id = ? AND team = ? AND status = 'needs_input'
         AND updated_at >= datetime('now', ?)
       ORDER BY updated_at DESC LIMIT 1`
    )
    .get(brandId, team, JOB_STALE_AFTER) as AgentJobRow | undefined;
}

/** Flips `running` rows left behind by a killed process (redeploy, crash, closed tab) to `error`
 *  so they stop presenting as live work. Called once at startup from instrumentation.ts — nothing
 *  else ever reaps these, since the code that would have finished them died with its stream. */
export function failStaleRunningJobs(): number {
  return db
    .prepare(
      `UPDATE agent_jobs SET status = 'error', label = 'הופסק עקב הפעלה מחדש של השרת',
         updated_at = datetime('now')
       WHERE status = 'running' AND updated_at < datetime('now', ?)`
    )
    .run(JOB_STALE_AFTER).changes;
}

// --- Plans (multi-agent orchestration) ---

interface PlanRow {
  id: string;
  brand_id: string;
  job_id: string | null;
  team: string | null;
  lead_agent_id: string | null;
  goal: string;
  status: PlanStatus;
  created_at: string;
  updated_at: string;
}

interface PlanTaskRow {
  id: string;
  plan_id: string;
  sequence: number;
  agent_id: string;
  deliverable_type: string;
  title: string;
  brief: string;
  depends_on: string;
  status: PlanTaskStatus;
  output_id: string | null;
  created_at: string;
  updated_at: string;
}

function planTaskRowToTask(row: PlanTaskRow): PlanTask {
  return {
    id: row.id,
    planId: row.plan_id,
    sequence: row.sequence,
    agentId: row.agent_id,
    deliverableType: row.deliverable_type,
    title: row.title,
    brief: row.brief,
    dependsOn: JSON.parse(row.depends_on) as string[],
    status: row.status,
    outputId: row.output_id,
  };
}

export function createPlan(params: {
  brandId: string;
  jobId?: string;
  team?: string;
  leadAgentId?: string;
  goal: string;
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO plans (id, brand_id, job_id, team, lead_agent_id, goal)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.brandId,
    params.jobId ?? null,
    params.team ?? null,
    params.leadAgentId ?? null,
    params.goal
  );
  return id;
}

/** Inserts all tasks for a plan in one go. `dependsOn` entries are indices into `tasks`,
 *  resolved to real task ids after each row gets its own generated id. */
export function createPlanTasks(
  planId: string,
  tasks: {
    agentId: string;
    deliverableType: string;
    title: string;
    brief: string;
    dependsOnIndex?: number[];
  }[]
): string[] {
  const ids = tasks.map(() => randomUUID());
  const insert = db.prepare(
    `INSERT INTO plan_tasks (id, plan_id, sequence, agent_id, deliverable_type, title, brief, depends_on, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  tasks.forEach((task, index) => {
    // `.filter(Boolean)` is a real guard, not decoration: an out-of-range or fractional index
    // resolves to `undefined`, which would serialize as `null` into depends_on and then never
    // match a real task id — permanently wedging this task at 'pending'. Callers sanitize too
    // (see toProposedPlan), but this is the last line before the value becomes persistent state.
    const dependsOnIds = (task.dependsOnIndex ?? []).map((i) => ids[i]).filter(Boolean);
    insert.run(
      ids[index],
      planId,
      index,
      task.agentId,
      task.deliverableType,
      task.title,
      task.brief,
      JSON.stringify(dependsOnIds),
      dependsOnIds.length === 0 ? "ready" : "pending"
    );
  });
  return ids;
}

export function getPlan(planId: string): Plan | undefined {
  const planRow = db.prepare(`SELECT * FROM plans WHERE id = ?`).get(planId) as
    | PlanRow
    | undefined;
  if (!planRow) return undefined;
  const taskRows = db
    .prepare(`SELECT * FROM plan_tasks WHERE plan_id = ? ORDER BY sequence ASC`)
    .all(planId) as PlanTaskRow[];
  return {
    id: planRow.id,
    brandId: planRow.brand_id,
    jobId: planRow.job_id,
    team: planRow.team,
    leadAgentId: planRow.lead_agent_id,
    goal: planRow.goal,
    status: planRow.status,
    tasks: taskRows.map(planTaskRowToTask),
  };
}

/** The plan (if any) tied to a given agent_jobs row — a plan's job_id points back to the job
 *  that proposed it, so a resumed job can find its paused plan without the caller tracking it. */
export function getPlanByJobId(jobId: string): Plan | undefined {
  const row = db.prepare(`SELECT id FROM plans WHERE job_id = ?`).get(jobId) as
    | { id: string }
    | undefined;
  return row ? getPlan(row.id) : undefined;
}

/** The task a plan was paused on (left 'in_progress' when the classifier returned
 *  needs_user_input mid-task) — what a resumed turn should pick back up on. */
export function getInProgressTask(planId: string): PlanTask | undefined {
  const row = db
    .prepare(`SELECT * FROM plan_tasks WHERE plan_id = ? AND status = 'in_progress' ORDER BY sequence ASC LIMIT 1`)
    .get(planId) as PlanTaskRow | undefined;
  return row ? planTaskRowToTask(row) : undefined;
}

export function updatePlanStatus(planId: string, status: PlanStatus): void {
  db.prepare(`UPDATE plans SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(
    status,
    planId
  );
}

export function updatePlanTaskStatus(
  taskId: string,
  status: PlanTaskStatus,
  outputId?: string
): void {
  const sets: string[] = ["status = ?", "updated_at = datetime('now')"];
  const values: unknown[] = [status];
  if (outputId !== undefined) {
    sets.push("output_id = ?");
    values.push(outputId);
  }
  values.push(taskId);
  db.prepare(`UPDATE plan_tasks SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/** Marks any 'pending' task whose dependencies are all 'done' as 'ready' — call after a task
 *  completes, before picking the next task to run. */
export function refreshReadyPlanTasks(planId: string): void {
  const taskRows = db
    .prepare(`SELECT * FROM plan_tasks WHERE plan_id = ?`)
    .all(planId) as PlanTaskRow[];
  const doneIds = new Set(taskRows.filter((t) => t.status === "done").map((t) => t.id));
  for (const row of taskRows) {
    if (row.status !== "pending") continue;
    const dependsOn = JSON.parse(row.depends_on) as string[];
    if (dependsOn.every((id) => doneIds.has(id))) {
      db.prepare(`UPDATE plan_tasks SET status = 'ready', updated_at = datetime('now') WHERE id = ?`).run(
        row.id
      );
    }
  }
}

/** The next task to execute: the lowest-sequence task in status 'ready'. */
export function getNextReadyTask(planId: string): PlanTask | undefined {
  const row = db
    .prepare(
      `SELECT * FROM plan_tasks WHERE plan_id = ? AND status = 'ready' ORDER BY sequence ASC LIMIT 1`
    )
    .get(planId) as PlanTaskRow | undefined;
  return row ? planTaskRowToTask(row) : undefined;
}

/** Tasks that never reached a terminal state. "No ready task" alone does NOT mean the plan
 *  finished — it also happens when the graph is blocked (a dependency failed or was skipped, or a
 *  malformed dependency can never be satisfied). Callers must check this before declaring success,
 *  otherwise a plan that ran one task out of five reports "התוכנית הושלמה". */
export function listUnfinishedPlanTasks(planId: string): PlanTask[] {
  const rows = db
    .prepare(
      `SELECT * FROM plan_tasks WHERE plan_id = ? AND status NOT IN ('done', 'skipped')
       ORDER BY sequence ASC`
    )
    .all(planId) as PlanTaskRow[];
  return rows.map(planTaskRowToTask);
}
