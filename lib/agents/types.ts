import { z } from "zod";

export const TeamSchema = z.enum(["marketing", "branding", "core"]);
export type Team = z.infer<typeof TeamSchema>;

export const AgentKindSchema = z.enum(["lead", "specialist", "core"]);
export type AgentKind = z.infer<typeof AgentKindSchema>;

export const ProviderSchema = z.enum(["anthropic", "openai", "omniroute"]);
export type Provider = z.infer<typeof ProviderSchema>;

export const AgentFrontmatterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  team: TeamSchema,
  reports_to: z.string().nullable().default(null),
  kind: AgentKindSchema,
  icon: z.string().min(1),
  description: z.string().min(1),
  output_types: z.array(z.string()).default([]),
  order: z.number().default(0),
  /** Which API this agent's `model` id belongs to. Defaults to anthropic for backward compatibility. */
  provider: ProviderSchema.default("anthropic"),
  model: z.string().default("claude-sonnet-5"),
  /** Whether this agent's replies may trigger autonomous handoff/auto-save (classifyNextStep).
   *  Defaults to true for all providers; set false to force every one of this agent's turns to
   *  stop and wait for the user instead. */
  auto_handoff_enabled: z.boolean().default(true),
});

export type AgentFrontmatter = z.infer<typeof AgentFrontmatterSchema>;

export interface AgentDef extends AgentFrontmatter {
  /** The markdown body — used as the agent's system prompt. */
  systemPrompt: string;
  filePath: string;
}

export const HandoffStatusSchema = z.enum([
  "queued",
  "in_progress",
  "done",
  "blocked",
  "revised",
]);
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>;

export interface HandoffRecord {
  task_id: string;
  from_agent: string;
  to_agent: string;
  status: HandoffStatus;
  deliverable_type: string;
  output_path: string | null;
  requested_by: string;
  created_at: string;
  updated_at: string;
  notes: string;
}

export const PlanStatusSchema = z.enum([
  "pending_approval",
  "approved",
  "running",
  "done",
  "cancelled",
]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const PlanTaskStatusSchema = z.enum([
  "pending",
  "ready",
  "in_progress",
  "done",
  "skipped",
  "failed",
]);
export type PlanTaskStatus = z.infer<typeof PlanTaskStatusSchema>;

export interface PlanTask {
  id: string;
  planId: string;
  sequence: number;
  agentId: string;
  deliverableType: string;
  title: string;
  brief: string;
  dependsOn: string[];
  status: PlanTaskStatus;
  outputId: string | null;
}

export interface Plan {
  id: string;
  brandId: string;
  jobId: string | null;
  team: string | null;
  leadAgentId: string | null;
  goal: string;
  status: PlanStatus;
  tasks: PlanTask[];
}

/** The lead proposed a multi-agent plan — execution is held until the user approves it. */
export interface PlanProposedEvent {
  type: "plan_proposed";
  plan: Plan;
}

/** A single task within an already-approved plan changed status during execution. */
export interface PlanTaskUpdateEvent {
  type: "plan_task_update";
  planId: string;
  taskId: string;
  status: PlanTaskStatus;
  agentId: string;
}

export interface RoutingEvent {
  type: "routing";
  from: string;
  to: string;
  reason: string;
}

export interface TokenEvent {
  type: "token";
  text: string;
}

export interface DoneEvent {
  type: "done";
  handoff: HandoffRecord | null;
  /** The concrete model that actually answered — for OmniRoute this is whatever real model its
   *  fallback chain picked, which can differ from the combo name the user selected. */
  resolvedModel?: string;
}

/** A specialist autonomously handed the request to another specialist mid-turn — distinct from
 *  RoutingEvent, which is only the team lead's initial pick. Starts a new message bubble for the
 *  next specialist's reply, which streams immediately after via further TokenEvents. */
export interface HandoffEvent {
  type: "handoff";
  from: string;
  to: string;
  reason: string;
}

/** A specialist's reply was classified as a finished deliverable and auto-saved — the chat bubble
 *  should show a short confirmation + link instead of the full text. */
export interface OutputSavedEvent {
  type: "output_saved";
  outputId: string;
  format: string;
  agentId: string;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type ChatStreamEvent =
  | RoutingEvent
  | TokenEvent
  | DoneEvent
  | HandoffEvent
  | OutputSavedEvent
  | ErrorEvent
  | PlanProposedEvent
  | PlanTaskUpdateEvent;

// --- Message content (text + file attachments) ---
// A focused subset of Anthropic's content block shapes — structurally compatible
// with Anthropic.MessageParam["content"], which is what these get passed as.

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ImageContentBlock {
  type: "image";
  source: { type: "base64"; media_type: ImageMediaType; data: string };
}

export interface DocumentContentBlock {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
  title?: string;
}

export type MessageContentBlock = TextContentBlock | ImageContentBlock | DocumentContentBlock;

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string | MessageContentBlock[];
}
