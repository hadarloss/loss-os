import OpenAI from "openai";

export class MissingOpenAIApiKeyError extends Error {
  constructor() {
    super(
      "OPENAI_API_KEY לא הוגדר. הוסיפו אותו לקובץ .env.local (ראו .env.example) והפעילו מחדש את השרת."
    );
    this.name = "MissingOpenAIApiKeyError";
  }
}

let client: OpenAI | null = null;

/** Server-side only. Never import this from a "use client" component. */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new MissingOpenAIApiKeyError();
  }
  if (!client) {
    client = new OpenAI({ apiKey });
  }
  return client;
}

export const DEFAULT_OPENAI_MODEL = "gpt-5.1";
export const OPENAI_MAX_TOKENS = 4096;
