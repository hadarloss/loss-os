import Anthropic from "@anthropic-ai/sdk";

export class MissingApiKeyError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY לא הוגדר. הוסיפו אותו לקובץ .env.local (ראו .env.example) והפעילו מחדש את השרת."
    );
    this.name = "MissingApiKeyError";
  }
}

let client: Anthropic | null = null;

/** Server-side only. Never import this from a "use client" component. */
export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new MissingApiKeyError();
  }
  if (!client) {
    client = new Anthropic({ apiKey });
  }
  return client;
}

export const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
export const MAX_TOKENS = 4096;
