import { createHmac, timingSafeEqual } from "crypto";

export const SESSION_COOKIE_NAME = "hastok_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  userId: string;
}

/**
 * Server-only signing secret. Falls back to an insecure dev default (same pattern as
 * the old APP_PASSWORD-derived secret) so local dev without a .env stays usable —
 * proxy.ts skips the auth gate entirely when SESSION_SECRET is unset in production-like
 * setups, this fallback only matters if someone sets SESSION_SECRET to "" explicitly.
 */
function getSecret(): string {
  return process.env.SESSION_SECRET || "insecure-dev-secret";
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  const payload = JSON.stringify({ userId, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 });
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  const expectedSig = sign(encoded);
  const a = Buffer.from(signature);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) return null;
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
