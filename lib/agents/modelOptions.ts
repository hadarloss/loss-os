/**
 * The 5 OmniRoute combos configured in OmniRoute's own dashboard (see CLAUDE.md) — every
 * agent in this app runs on `provider: omniroute`, so these are the only models a user can
 * switch a conversation to. Each combo is itself a priority-ordered fallback chain of real
 * models (Gemini/Groq/Z.AI/OpenRouter), configured outside this repo.
 */
export interface ModelOption {
  value: string;
  label: string;
}

export const OMNIROUTE_MODEL_OPTIONS: ModelOption[] = [
  { value: "archetype-a-routing", label: "ניתוב — מהיר וזול" },
  { value: "archetype-b-critical-qa", label: "ביקורת ו-QA — חזק ומדויק" },
  { value: "archetype-c-strategic-foundational", label: "יסודות אסטרטגיים" },
  { value: "archetype-d-ongoing-content", label: "תוכן שוטף — ברירת המחדל לרוב הסוכנים" },
  { value: "archetype-e-high-volume-templates", label: "תבניות בנפח גבוה" },
];
