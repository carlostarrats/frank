// v0 Platform API client. Owns all calls to api.v0.dev so the API key never
// crosses the WS into the browser. Every error is mapped to a stable error
// code the UI can switch on instead of parsing English strings.

// Used by testToken, getChat, sendMessage in Tasks 4–5 (appended to this file).
const V0_API_BASE = 'https://api.v0.dev';
// Bare-ID heuristic — see parseChatUrl JSDoc for the length floor rationale.
const CHAT_ID_RE = /^[A-Za-z0-9_-]{6,}$/;

/**
 * Extract a chat ID from a v0 chat URL or accept a bare ID.
 *
 * Accepts:
 *   - https://v0.dev/chat/<id>
 *   - https://v0.app/chat/<id>
 *   with optional trailing path segments (revisions like /r/v2) or query strings.
 *
 * Also accepts a bare chat ID for users who pasted just the ID instead of the
 * full URL. The bare-ID path requires ≥6 alphanumeric/_- chars to avoid false
 * positives on short common strings; the URL path has no length floor because
 * the `/chat/` prefix is already an unambiguous marker. If v0 ever issues IDs
 * shorter than 6 chars, paste the full URL instead.
 *
 * Returns null if the input doesn't look like a chat reference at all. The
 * returned ID is not validated against v0's API — that happens in getChat().
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
