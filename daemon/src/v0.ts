// v0 Platform API client. Owns all calls to api.v0.dev so the API key never
// crosses the WS into the browser. Every error is mapped to a stable error
// code the UI can switch on instead of parsing English strings.

// Base URL for every v0 Platform API call. Live as of 2026-04 — see plan doc.
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

// Stable error codes the API client raises. Note: 'no_token' is *not* here —
// that code is emitted only by daemon WS handlers (server.ts) when the user
// has no v0 config saved, never by this client (which always receives a key
// from its caller). The user-facing V0SendResponse.errorCode union in
// protocol.ts is a superset that includes 'no_token'.
export type V0ErrorCode = 'invalid_token' | 'chat_not_found' | 'rate_limit' | 'network' | 'unknown';

export class V0Error extends Error {
  code: V0ErrorCode;
  constructor(code: V0ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'V0Error';
  }
}

type Fetch = typeof fetch;

// Shared by GET (testToken/getChat) and POST (sendMessage). Content-Type is
// harmless on GET — servers ignore it when there's no body — and keeping the
// helper unified is cheaper than splitting it.
function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

function mapStatus(status: number): V0ErrorCode {
  if (status === 401 || status === 403) return 'invalid_token';
  if (status === 404) return 'chat_not_found';
  if (status === 429) return 'rate_limit';
  return 'unknown';
}

/** Lightweight token validation. Hits /v1/user — cheap and read-only. */
export async function testToken(apiKey: string, f: Fetch = fetch): Promise<boolean> {
  let res: Response;
  try {
    res = await f(`${V0_API_BASE}/v1/user`, { headers: authHeaders(apiKey) });
  } catch (e: any) {
    throw new V0Error('network', e?.message || 'network error');
  }
  return res.ok;
}

export interface V0Chat {
  id: string;
  name: string;
  webUrl: string;
}

/** Fetch chat metadata. Used to validate a pasted URL and pull the display name. */
export async function getChat(apiKey: string, chatId: string, f: Fetch = fetch): Promise<V0Chat> {
  let res: Response;
  try {
    res = await f(`${V0_API_BASE}/v1/chats/${encodeURIComponent(chatId)}`, { headers: authHeaders(apiKey) });
  } catch (e: any) {
    throw new V0Error('network', e?.message || 'network error');
  }
  if (!res.ok) throw new V0Error(mapStatus(res.status), `v0 returned ${res.status}`);
  const body = await res.json() as { id: string; name?: string; webUrl?: string };
  return {
    id: body.id,
    name: body.name || 'Untitled chat',
    webUrl: body.webUrl || `https://v0.dev/chat/${chatId}`,
  };
}
