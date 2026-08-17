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

// Only confirmed-working model ids belong here — this list has already burned twice on a
// plausible-sounding but nonexistent tier name reaching production ("GPT-5.6 Terra", then
// "gpt-5.1-mini": both 400'd with "model does not exist" the first time an agent actually used
// them). Every id below is one already exercised successfully in production by a real agent.
// Verify a new id actually exists in the relevant provider account before adding it back.
export const ANTHROPIC_MODEL_OPTIONS: ModelOption[] = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku — מהיר וזול" },
];

export const OPENAI_MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-5.1", label: "GPT-5.1" },
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
