/**
 * The envelope agents wrap a finished artifact in, and the helpers for reading it back.
 *
 * Lives in its own module (rather than in lib/agents/orchestration.ts, where it's used) because
 * the chat UI has to strip these markers before rendering, and orchestration.ts transitively
 * imports better-sqlite3 — importing it from a client component would drag the whole server DB
 * layer into the browser bundle.
 *
 * The rule that produces these markers is in GLOBAL_RULES_BLOCK (lib/agents/router.ts), applied
 * to every agent's system prompt.
 */
export const DELIVERABLE_OPEN = "<<<תוצר>>>";
export const DELIVERABLE_CLOSE = "<<<סוף תוצר>>>";

/**
 * The finished artifact inside a reply, or null when the agent didn't mark one.
 *
 * This is a structural signal the classifier never had: previously nothing distinguished a real
 * deliverable from a description of one, so "here's how I'd approach this" replies were saved to
 * the outputs page verbatim. Returning null is deliberately non-fatal — callers fall back to the
 * existing classifier-driven behavior, so a missing marker can never cost the user real work.
 */
export function extractDeliverable(text: string): string | null {
  const start = text.indexOf(DELIVERABLE_OPEN);
  if (start === -1) return null;
  const from = start + DELIVERABLE_OPEN.length;
  const end = text.indexOf(DELIVERABLE_CLOSE, from);
  if (end === -1) return null;
  const inner = text.slice(from, end).trim();
  return inner.length > 0 ? inner : null;
}

/** Removes the markers for display, leaving the text itself intact. They're an internal protocol
 *  between the orchestrator and the agents — users should never see them. */
export function stripDeliverableMarkers(text: string): string {
  return text.split(DELIVERABLE_OPEN).join("").split(DELIVERABLE_CLOSE).join("").trim();
}
