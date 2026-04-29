// v0 Platform API client. Owns all calls to api.v0.dev so the API key never
// crosses the WS into the browser. Every error is mapped to a stable error
// code the UI can switch on instead of parsing English strings.

const V0_API_BASE = 'https://api.v0.dev';
const CHAT_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

/**
 * Extract a chat ID from a v0 chat URL or accept a bare ID.
 * Accepts: https://v0.dev/chat/<id>, https://v0.app/chat/<id>, with optional
 * trailing path segments (revisions like /r/v2) or query strings.
 * Returns null if the input doesn't look like a chat reference at all.
 */
export function parseChatUrl(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (CHAT_ID_RE.test(trimmed)) return trimmed;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (!/(^|\.)v0\.(dev|app)$/.test(url.hostname)) return null;
  const m = url.pathname.match(/^\/chat\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
