import * as http from "node:http";
import * as https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";

const FETCH_TIMEOUT_MS = 8000;
const MAX_RESPONSE_BYTES = 500_000;
const MAX_EXTRACTED_CHARS = 6000;
const MAX_REDIRECTS = 3;
/** Hard wall-clock ceiling for the entire fetch including redirects — see fetchWebsiteText. */
const TOTAL_DEADLINE_MS = 12_000;

function isPrivateOrReservedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 — link-local, and specifically where cloud metadata endpoints
    // (169.254.169.254) live; blocking this range is the whole point of validating the IP.
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7
    if (lower.startsWith("::ffff:")) {
      const v4 = lower.slice("::ffff:".length);
      if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
    }
    return false;
  }
  return true; // unrecognized format — refuse rather than guess
}

/** Resolves hostname → first non-private IP, or null if none exists / lookup fails. */
async function resolveSafeIp(hostname: string): Promise<string | null> {
  try {
    const results = await dns.lookup(hostname, { all: true });
    const safe = results.find((r) => !isPrivateOrReservedIp(r.address));
    return safe?.address ?? null;
  } catch {
    return null;
  }
}

/** Fetches one URL's raw HTML, pinned to a pre-validated IP so the actual TCP connection can never
 *  land somewhere different from what was checked (DNS-rebinding-safe), with a manually-followed,
 *  re-validated redirect chain (Node's http/https `get` doesn't follow redirects on its own). */
async function fetchHtmlOnce(url: URL, redirectsLeft: number): Promise<string | null> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const resolvedIp = await resolveSafeIp(url.hostname);
  if (!resolvedIp) return null;

  const outcome = await new Promise<
    { kind: "html"; html: string } | { kind: "redirect"; location: string } | { kind: "fail" }
  >((resolve) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(
      url.toString(),
      {
        timeout: FETCH_TIMEOUT_MS,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HastokOnboardingBot/1.0)" },
        lookup: (_hostname, _options, callback) => {
          callback(null, resolvedIp, net.isIPv6(resolvedIp) ? 6 : 4);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ kind: "redirect", location: res.headers.location });
          return;
        }
        if (status >= 400 || status === 0) {
          res.resume();
          resolve({ kind: "fail" });
          return;
        }
        let total = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ kind: "html", html: Buffer.concat(chunks).toString("utf-8") }));
        res.on("error", () => resolve({ kind: "fail" }));
      }
    );
    req.on("error", () => resolve({ kind: "fail" }));
    req.on("timeout", () => req.destroy());
  });

  if (outcome.kind === "html") return outcome.html;
  if (outcome.kind === "redirect" && redirectsLeft > 0) {
    let nextUrl: URL;
    try {
      nextUrl = new URL(outcome.location, url);
    } catch {
      return null;
    }
    return fetchHtmlOnce(nextUrl, redirectsLeft - 1);
  }
  return null;
}

function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Best-effort: fetches a user-supplied business website and returns cleaned, readable text for
 * אורית to fold into the onboarding synthesis — or null on any failure (invalid URL, private/
 * internal target, timeout, non-2xx, empty page). Never throws; callers should treat null as
 * "skip this, proceed without site content" rather than a hard onboarding failure.
 */
export async function fetchWebsiteText(rawUrl: string): Promise<string | null> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  // Node's `timeout` option is an *idle* timeout — it resets on every byte, so a server trickling
  // one byte every few seconds keeps the request (and the onboarding call awaiting it) alive
  // indefinitely. This is the only hard wall-clock bound across the whole redirect chain.
  let deadlineTimer: NodeJS.Timeout | undefined;
  const html = await Promise.race([
    fetchHtmlOnce(url, MAX_REDIRECTS),
    new Promise<null>((resolve) => {
      deadlineTimer = setTimeout(() => resolve(null), TOTAL_DEADLINE_MS);
    }),
  ]).finally(() => clearTimeout(deadlineTimer));

  if (!html) return null;

  const text = extractReadableText(html);
  return text ? text.slice(0, MAX_EXTRACTED_CHARS) : null;
}
