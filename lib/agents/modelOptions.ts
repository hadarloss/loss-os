/**
 * Real, selectable models per provider — shown in the chat composer's model line so the user
 * always sees which model is actually answering and can switch within the active agent's own
 * provider (switching provider entirely would require a different persona/routing pipeline, not
 * just a model swap, so options are always scoped to one provider at a time).
 */
export interface ModelOption {
  value: string;
  label: string;
}

export const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku — מהיר וזול" },
  { value: "claude-sonnet-5", label: "Claude Sonnet — מאוזן" },
  { value: "claude-opus-5", label: "Claude Opus — חזק ויקר" },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-5.1-mini", label: "GPT-5.1 mini — מהיר וזול" },
  { value: "gpt-5.1", label: "GPT-5.1 — מלא" },
];

/** Accepts a loose string (some call sites only have an `AgentLite`-typed provider, not the
 *  strict `Provider` union) — any value outside the two known providers just gets no options. */
export function modelOptionsForProvider(provider: string | undefined): ModelOption[] {
  if (provider === "openai") return OPENAI_MODEL_OPTIONS;
  if (provider === "anthropic") return ANTHROPIC_MODEL_OPTIONS;
  return [];
}

export const ALL_MODEL_VALUES = new Set([
  ...ANTHROPIC_MODEL_OPTIONS.map((o) => o.value),
  ...OPENAI_MODEL_OPTIONS.map((o) => o.value),
]);
