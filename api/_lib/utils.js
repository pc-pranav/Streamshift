// api/_lib/utils.js  — shared across all serverless functions

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Platform",
};

export function setCors(res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
}

// ── Exponential backoff with jitter ─────────────────────────────────────────
export async function withRetry(fn, { maxAttempts = 3, baseDelayMs = 600, label = "" } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn(attempt);
      return result;
    } catch (err) {
      lastErr = err;
      // Don't retry 4xx (except 429) — they won't change
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
      if (attempt < maxAttempts) {
        const jitter = Math.random() * 300;
        const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
        console.warn(`[${label}] attempt ${attempt} failed (${err.message}), retrying in ${Math.round(delay)}ms`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}

// ── Fetch with timeout + structured error ────────────────────────────────────
export async function timedFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      const e = new Error(`Request timed out after ${timeoutMs / 1000}s`);
      e.status = 504; throw e;
    }
    const e = new Error(`Network error: ${err.message}`);
    e.status = 503; throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Parse Retry-After header safely ─────────────────────────────────────────
export function retryAfterSecs(res) {
  const h = res.headers?.get?.("Retry-After");
  return h ? Math.min(parseInt(h, 10) + 1, 60) : 5;
}

// ── Standard API error response ──────────────────────────────────────────────
export function apiError(res, status, code, message, extra = {}) {
  return res.status(status).json({ error: code, message, ...extra });
}

// ── Sleep ────────────────────────────────────────────────────────────────────
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Normalize track string for matching ─────────────────────────────────────
const STRIP = [
  /\s*[\(\[](feat\.?|ft\.?|with)\s+[^\)\]]+[\)\]]/gi,
  /\s*[\(\[](remaster(?:ed)?|live(?: at [^)\]]+)?|acoustic|radio\s*edit|single\s*version|deluxe|album\s*version|explicit|clean)[^\)\]]*[\)\]]/gi,
  /\s*-\s*(single|ep|remaster(?:ed)?|live|acoustic|explicit|clean)\s*$/gi,
  /[^\w\s]/g,
];
export function normalizeStr(s) {
  if (!s) return "";
  let r = s.toLowerCase().trim();
  for (const p of STRIP) r = r.replace(p, "");
  return r.replace(/\s+/g, " ").trim();
}

// ── Jaro-Winkler similarity (0-1) ────────────────────────────────────────────
export function jaroWinkler(s1, s2) {
  s1 = s1 || ""; s2 = s2 || "";
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const dist = Math.max(Math.floor(Math.max(s1.length, s2.length) / 2) - 1, 0);
  const m1 = new Array(s1.length).fill(false);
  const m2 = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    for (let j = Math.max(0, i - dist); j < Math.min(i + dist + 1, s2.length); j++) {
      if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; matches++; break; }
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - t / 2) / matches) / 3;
  let p = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) p++; else break;
  }
  return jaro + p * 0.1 * (1 - jaro);
}

// ── Weighted match score ─────────────────────────────────────────────────────
export function matchScore(src, cand) {
  const titleS  = jaroWinkler(normalizeStr(src.title),  normalizeStr(cand.title));
  const artists = cand.artists?.length ? cand.artists : [cand.artist].filter(Boolean);
  const artistS = Math.max(...artists.map(a => jaroWinkler(normalizeStr(src.artist || ""), normalizeStr(a))));
  const durS    = durationScore(src.durationMs, cand.durationMs);
  const albumS  = jaroWinkler(normalizeStr(src.album || ""), normalizeStr(cand.album || ""));
  return titleS * 0.40 + artistS * 0.30 + durS * 0.20 + albumS * 0.10;
}

function durationScore(a, b) {
  if (!a || !b) return 0.5;
  return Math.max(0, 1 - Math.abs(a - b) / 15000);
}

// ── Classify match status from score ────────────────────────────────────────
export function classifyStatus(score) {
  if (score >= 0.90) return "matched";
  if (score >= 0.65) return "conflict";
  return "unmatched";
}
