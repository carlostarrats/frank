# v0 Platform API Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "Send to v0" deep-link button with a true API integration that posts curated feedback as a follow-up message into an existing v0 chat — solving the "every click forks a new chat" problem from the deep-link approach.

**Architecture:** Daemon owns the v0 token (stored in `~/.frank/config.json` mode 0600, never sent to the browser) and makes all v0 API calls. Per-project chat targets live on `ProjectV2.v0Chats` as `{ chatId, label, lastUsedAt }[]`. The curation panel shows a state-aware Send button: token+chats configured → one-click append to last-used chat; token configured but project has no chats → inline paste form; no token → existing deep-link path remains as the fallback. v0's `responseMode: 'async'` is used so the WS request returns in <1s regardless of how long v0's model takes — the user gets a toast with a "View in v0" link immediately.

**Tech Stack:** Node.js + TypeScript daemon, native `fetch` (no SDK dep — `v0-sdk` is optional and adds 200KB), plain JS UI (no build step).

**Verified API surface (2026-04-29):**
- Base: `https://api.v0.dev`
- Auth: `Authorization: Bearer $V0_API_KEY`
- Send: `POST /v1/chats/{chatId}/messages` body `{ message: string, responseMode?: 'sync' | 'async' | 'experimental_stream' }` returns `{ id, webUrl, ... }`
- Get chat (for label lookup + URL validation): `GET /v1/chats/{chatId}` returns `{ id, name, webUrl, ... }`
- Daily limits: 1000 chat messages, 10000 API requests
- Get API key: https://v0.dev/chat/settings/keys

---

## File Structure

**New:**
- `daemon/src/v0.ts` — v0 client (parseChatUrl, testToken, getChat, sendMessage, error mapping)
- `daemon/src/v0.test.ts` — unit tests (mocked fetch)

**Modified:**
- `daemon/src/protocol.ts` — `V0ChatTarget` type, `Project.v0Chats` field, request/response message types
- `daemon/src/cloud.ts` — `getV0Config` / `saveV0Config` / `clearV0Config` / `getV0ConfiguredAt` (parallels Vercel deploy block)
- `daemon/src/projects.ts` — `addV0Chat` / `removeV0Chat` / `touchV0Chat` (writes via existing atomic save)
- `daemon/src/projects.test.ts` — tests for chat list ops
- `daemon/src/server.ts` — message handlers: `get-v0-config`, `set-v0-config`, `clear-v0-config`, `test-v0-token`, `add-v0-chat`, `remove-v0-chat`, `send-to-v0-chat`
- `ui-v2/core/sync.js` — wrapper methods for the new WS messages
- `ui-v2/components/settings-panel.js` — v0 token section (mirror Vercel token UI)
- `ui-v2/components/curation.js` — replace `sendCommentsToV0` with state-aware version + chat picker popover
- `ui-v2/styles/app.css` — picker popover styles

---

## Task 1: Type definitions

**Files:**
- Modify: `daemon/src/protocol.ts`

- [ ] **Step 1: Add `V0ChatTarget` and field on `ProjectV2`**

Add after the `intent?` / `sourceDir?` fields in `ProjectV2`:

```ts
  // v3.18: v0 Platform API targets — which v0 chat(s) this Frank project
  // routes Send-to-v0 clicks into. First chat is auto-promoted to default;
  // most-recently-used wins on subsequent sends. Absence = no chats yet.
  v0Chats?: V0ChatTarget[];
}

export interface V0ChatTarget {
  chatId: string;          // v0's chat ID (parsed from chat URL)
  label: string;           // v0's `name` field at time of add — display only
  lastUsedAt: string;      // ISO; updated on each successful send
  addedAt: string;         // ISO; immutable
}
```

- [ ] **Step 2: Add WS message types**

After `SetProjectSourceDirRequest`:

```ts
export interface GetV0ConfigRequest { type: 'get-v0-config'; requestId?: number; }
export interface SetV0ConfigRequest { type: 'set-v0-config'; apiKey: string; requestId?: number; }
export interface ClearV0ConfigRequest { type: 'clear-v0-config'; requestId?: number; }
export interface TestV0TokenRequest { type: 'test-v0-token'; apiKey: string; requestId?: number; }
export interface AddV0ChatRequest { type: 'add-v0-chat'; projectId: string; chatUrl: string; requestId?: number; }
export interface RemoveV0ChatRequest { type: 'remove-v0-chat'; projectId: string; chatId: string; requestId?: number; }
export interface SendToV0ChatRequest { type: 'send-to-v0-chat'; projectId: string; chatId: string; message: string; commentIds: string[]; requestId?: number; }

export interface V0ConfigResponse {
  type: 'v0-config';
  hasKey: boolean;
  configuredAt: string | null;
  requestId?: number;
}

export interface V0SendResponse {
  type: 'v0-send-result';
  ok: boolean;
  webUrl?: string;
  errorCode?: 'no_token' | 'invalid_token' | 'chat_not_found' | 'rate_limit' | 'network' | 'unknown';
  errorMessage?: string;
  requestId?: number;
}
```

- [ ] **Step 3: Verify tsc**

Run: `cd daemon && npm run build`
Expected: clean exit; no new type errors.

- [ ] **Step 4: Commit**

```bash
git add daemon/src/protocol.ts
git commit -m "feat(v0): add V0ChatTarget type + WS message contracts"
```

---

## Task 2: Token storage in cloud.ts

**Files:**
- Modify: `daemon/src/cloud.ts`
- Test: `daemon/src/cloud.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Append to (or create) `daemon/src/cloud.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('./protocol.js', async () => {
  const tmp = path.join(os.tmpdir(), 'frank-cloud-test-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  return { CONFIG_PATH: path.join(tmp, 'config.json') };
});

describe('v0 token storage', () => {
  let mod: typeof import('./cloud.js');
  beforeEach(async () => { mod = await import('./cloud.js'); });

  it('round-trips the v0 API key', () => {
    expect(mod.getV0Config()).toBeNull();
    mod.saveV0Config('v0_test_key_abc');
    expect(mod.getV0Config()).toEqual({ apiKey: 'v0_test_key_abc' });
    expect(mod.getV0ConfiguredAt()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('clears cleanly', () => {
    mod.saveV0Config('v0_test_key_abc');
    mod.clearV0Config();
    expect(mod.getV0Config()).toBeNull();
    expect(mod.getV0ConfiguredAt()).toBeNull();
  });

  it('writes config at mode 0600', () => {
    mod.saveV0Config('v0_test_key_abc');
    const stat = fs.statSync((mod as any).__configPath ?? path.join(os.tmpdir(), 'frank-cloud-test'));
    // 0o600 == owner-only read+write
    expect(stat.mode & 0o777).toBe(0o600);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd daemon && npx vitest run src/cloud.test.ts`
Expected: tests fail — `getV0Config` etc. not defined.

- [ ] **Step 3: Implement**

Append to `daemon/src/cloud.ts`:

```ts
// ─── v0 Platform API token (per-project chat IDs live on the project; only
//     the account-level API key lives in config.json) ──────────────────────

export interface V0Config {
  apiKey: string;
}

export function getV0Config(): V0Config | null {
  const config = readRawConfig();
  const block = config.v0 as { apiKey?: string } | undefined;
  if (!block || !block.apiKey) return null;
  return { apiKey: block.apiKey };
}

export function saveV0Config(apiKey: string): void {
  const config = readRawConfig();
  config.v0 = { apiKey };
  config.v0ConfiguredAt = new Date().toISOString();
  writeConfigSecure(config);
}

export function clearV0Config(): void {
  const config = readRawConfig();
  delete config.v0;
  delete config.v0ConfiguredAt;
  writeConfigSecure(config);
}

export function getV0ConfiguredAt(): string | null {
  const config = readRawConfig();
  return (config.v0ConfiguredAt as string) || null;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd daemon && npx vitest run src/cloud.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/cloud.ts daemon/src/cloud.test.ts
git commit -m "feat(v0): persist v0 API key in 0600 config block"
```

---

## Task 3: v0 client module — chat URL parsing

**Files:**
- Create: `daemon/src/v0.ts`
- Create: `daemon/src/v0.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseChatUrl } from './v0.js';

describe('parseChatUrl', () => {
  it('extracts chat ID from v0.dev URL', () => {
    expect(parseChatUrl('https://v0.dev/chat/abc123XyZ')).toBe('abc123XyZ');
  });
  it('extracts chat ID from v0.app URL', () => {
    expect(parseChatUrl('https://v0.app/chat/abc123XyZ')).toBe('abc123XyZ');
  });
  it('handles trailing path segments (revisions)', () => {
    expect(parseChatUrl('https://v0.dev/chat/abc123/r/v2')).toBe('abc123');
  });
  it('handles trailing slash and query string', () => {
    expect(parseChatUrl('https://v0.dev/chat/abc123/?ref=share')).toBe('abc123');
  });
  it('returns null for non-chat URLs', () => {
    expect(parseChatUrl('https://v0.dev/')).toBeNull();
    expect(parseChatUrl('https://example.com/chat/abc')).toBeNull();
    expect(parseChatUrl('not a url')).toBeNull();
  });
  it('accepts a bare chat ID (user pasted just the ID, no URL)', () => {
    expect(parseChatUrl('abc123XyZ')).toBe('abc123XyZ');
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd daemon && npx vitest run src/v0.test.ts`
Expected: cannot find module `./v0.js`.

- [ ] **Step 3: Implement parseChatUrl**

Create `daemon/src/v0.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd daemon && npx vitest run src/v0.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/v0.ts daemon/src/v0.test.ts
git commit -m "feat(v0): parseChatUrl — extract chatId from v0.dev/.app URLs"
```

---

## Task 4: v0 client — testToken + getChat

**Files:**
- Modify: `daemon/src/v0.ts`
- Modify: `daemon/src/v0.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `v0.test.ts`:

```ts
import { testToken, getChat, V0Error } from './v0.js';

describe('testToken', () => {
  it('returns true on 200', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await testToken('v0_good', fetchStub as any)).toBe(true);
    expect(fetchStub).toHaveBeenCalledWith(
      'https://api.v0.dev/v1/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer v0_good' }) }),
    );
  });
  it('returns false on 401', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    expect(await testToken('v0_bad', fetchStub as any)).toBe(false);
  });
  it('throws on network error', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(testToken('v0_bad', fetchStub as any)).rejects.toBeInstanceOf(V0Error);
  });
});

describe('getChat', () => {
  it('returns name + webUrl on 200', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'abc', name: 'Header refactor', webUrl: 'https://v0.dev/chat/abc',
    }), { status: 200 }));
    const r = await getChat('v0_good', 'abc', fetchStub as any);
    expect(r).toEqual({ id: 'abc', name: 'Header refactor', webUrl: 'https://v0.dev/chat/abc' });
  });
  it('throws chat_not_found on 404', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(getChat('v0_good', 'abc', fetchStub as any)).rejects.toMatchObject({ code: 'chat_not_found' });
  });
  it('throws invalid_token on 401', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(getChat('v0_bad', 'abc', fetchStub as any)).rejects.toMatchObject({ code: 'invalid_token' });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd daemon && npx vitest run src/v0.test.ts`
Expected: imports `testToken`, `getChat`, `V0Error` not found.

- [ ] **Step 3: Implement**

Append to `daemon/src/v0.ts`:

```ts
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
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd daemon && npx vitest run src/v0.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/v0.ts daemon/src/v0.test.ts
git commit -m "feat(v0): testToken + getChat with stable error codes"
```

---

## Task 5: v0 client — sendMessage

**Files:**
- Modify: `daemon/src/v0.ts`
- Modify: `daemon/src/v0.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `v0.test.ts`:

```ts
import { sendMessage } from './v0.js';

describe('sendMessage', () => {
  it('POSTs to the right URL with async responseMode', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'msg_1', webUrl: 'https://v0.dev/chat/abc',
    }), { status: 200 }));
    const r = await sendMessage('v0_good', 'abc', 'do the thing', fetchStub as any);
    expect(r).toEqual({ id: 'msg_1', webUrl: 'https://v0.dev/chat/abc' });
    const call = fetchStub.mock.calls[0];
    expect(call[0]).toBe('https://api.v0.dev/v1/chats/abc/messages');
    expect(call[1].method).toBe('POST');
    const body = JSON.parse(call[1].body);
    expect(body).toEqual({ message: 'do the thing', responseMode: 'async' });
  });
  it('maps 429 to rate_limit', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(sendMessage('v0_good', 'abc', 'x', fetchStub as any))
      .rejects.toMatchObject({ code: 'rate_limit' });
  });
  it('maps 404 to chat_not_found', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(sendMessage('v0_good', 'abc', 'x', fetchStub as any))
      .rejects.toMatchObject({ code: 'chat_not_found' });
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd daemon && npx vitest run src/v0.test.ts`
Expected: `sendMessage` not exported.

- [ ] **Step 3: Implement**

Append to `daemon/src/v0.ts`:

```ts
export interface V0SendResult {
  id: string;
  webUrl: string;
}

/**
 * POST a follow-up message into an existing chat. Uses async responseMode so
 * we return as soon as v0 acknowledges the message — model generation can
 * take 30-60s, longer than the WS request timeout. The user follows the
 * webUrl to see the response.
 */
export async function sendMessage(
  apiKey: string,
  chatId: string,
  message: string,
  f: Fetch = fetch,
): Promise<V0SendResult> {
  let res: Response;
  try {
    res = await f(`${V0_API_BASE}/v1/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify({ message, responseMode: 'async' }),
    });
  } catch (e: any) {
    throw new V0Error('network', e?.message || 'network error');
  }
  if (!res.ok) throw new V0Error(mapStatus(res.status), `v0 returned ${res.status}`);
  const body = await res.json() as { id?: string; webUrl?: string };
  return {
    id: body.id || '',
    webUrl: body.webUrl || `https://v0.dev/chat/${chatId}`,
  };
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd daemon && npx vitest run src/v0.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/v0.ts daemon/src/v0.test.ts
git commit -m "feat(v0): sendMessage — async POST to existing chat"
```

---

## Task 6: Project chat list operations

**Files:**
- Modify: `daemon/src/projects.ts`
- Modify: `daemon/src/projects.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `projects.test.ts`:

```ts
describe('v0 chat list', () => {
  it('addV0Chat appends a new target', () => {
    const id = createProject('v0-list', 'url', 'http://x').projectId;
    addV0Chat(id, { chatId: 'c1', label: 'Header', lastUsedAt: '2026-04-29T00:00:00Z', addedAt: '2026-04-29T00:00:00Z' });
    expect(loadProject(id).v0Chats).toEqual([
      { chatId: 'c1', label: 'Header', lastUsedAt: '2026-04-29T00:00:00Z', addedAt: '2026-04-29T00:00:00Z' },
    ]);
  });
  it('addV0Chat is idempotent on chatId — overwrites label/timestamps', () => {
    const id = createProject('v0-idem', 'url', 'http://x').projectId;
    addV0Chat(id, { chatId: 'c1', label: 'Old', lastUsedAt: 't1', addedAt: 't1' });
    addV0Chat(id, { chatId: 'c1', label: 'New', lastUsedAt: 't2', addedAt: 't1' });
    const list = loadProject(id).v0Chats!;
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('New');
  });
  it('removeV0Chat drops the entry', () => {
    const id = createProject('v0-rm', 'url', 'http://x').projectId;
    addV0Chat(id, { chatId: 'c1', label: 'A', lastUsedAt: 't', addedAt: 't' });
    addV0Chat(id, { chatId: 'c2', label: 'B', lastUsedAt: 't', addedAt: 't' });
    removeV0Chat(id, 'c1');
    expect(loadProject(id).v0Chats!.map(c => c.chatId)).toEqual(['c2']);
  });
  it('touchV0Chat bumps lastUsedAt', () => {
    const id = createProject('v0-touch', 'url', 'http://x').projectId;
    addV0Chat(id, { chatId: 'c1', label: 'A', lastUsedAt: '2026-01-01T00:00:00Z', addedAt: '2026-01-01T00:00:00Z' });
    touchV0Chat(id, 'c1');
    const list = loadProject(id).v0Chats!;
    expect(new Date(list[0].lastUsedAt).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00Z').getTime());
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd daemon && npx vitest run src/projects.test.ts`
Expected: imports `addV0Chat`, `removeV0Chat`, `touchV0Chat` not found.

- [ ] **Step 3: Implement**

In `daemon/src/projects.ts`, find the existing `setProjectIntent` function and add these alongside it (export them from the module):

```ts
import type { V0ChatTarget } from './protocol.js';

export function addV0Chat(projectId: string, target: V0ChatTarget): void {
  const project = loadProject(projectId);
  const list = project.v0Chats ?? [];
  const existing = list.findIndex(c => c.chatId === target.chatId);
  if (existing >= 0) {
    // Preserve the original addedAt; overwrite the rest
    list[existing] = { ...target, addedAt: list[existing].addedAt };
  } else {
    list.push(target);
  }
  project.v0Chats = list;
  saveProject(projectId, project);
}

export function removeV0Chat(projectId: string, chatId: string): void {
  const project = loadProject(projectId);
  if (!project.v0Chats) return;
  project.v0Chats = project.v0Chats.filter(c => c.chatId !== chatId);
  if (project.v0Chats.length === 0) delete project.v0Chats;
  saveProject(projectId, project);
}

export function touchV0Chat(projectId: string, chatId: string): void {
  const project = loadProject(projectId);
  if (!project.v0Chats) return;
  const target = project.v0Chats.find(c => c.chatId === chatId);
  if (!target) return;
  target.lastUsedAt = new Date().toISOString();
  saveProject(projectId, project);
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd daemon && npx vitest run src/projects.test.ts`
Expected: all tests pass (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add daemon/src/projects.ts daemon/src/projects.test.ts
git commit -m "feat(v0): per-project chat list — add/remove/touch"
```

---

## Task 7: Daemon WS handlers

**Files:**
- Modify: `daemon/src/server.ts`

- [ ] **Step 1: Add imports near other cloud/projects imports**

```ts
import { getV0Config, saveV0Config, clearV0Config, getV0ConfiguredAt } from './cloud.js';
import { addV0Chat, removeV0Chat, touchV0Chat } from './projects.js';
import { parseChatUrl, testToken as testV0Token, getChat as getV0Chat, sendMessage as sendV0Message, V0Error } from './v0.js';
```

- [ ] **Step 2: Add handlers in the message switch**

Find the existing `case 'set-cloud-config':` block and add these cases nearby (group with cloud/config handlers):

```ts
case 'get-v0-config': {
  reply({ type: 'v0-config', hasKey: !!getV0Config(), configuredAt: getV0ConfiguredAt() });
  break;
}

case 'set-v0-config': {
  if (!msg.apiKey) { reply({ type: 'error', error: 'apiKey required' }); break; }
  saveV0Config(msg.apiKey);
  reply({ type: 'v0-config', hasKey: true, configuredAt: getV0ConfiguredAt() });
  break;
}

case 'clear-v0-config': {
  clearV0Config();
  reply({ type: 'v0-config', hasKey: false, configuredAt: null });
  break;
}

case 'test-v0-token': {
  try {
    const ok = await testV0Token(msg.apiKey);
    reply({ type: 'v0-test-result', ok });
  } catch (e: any) {
    reply({ type: 'v0-test-result', ok: false, error: e?.message || 'network error' });
  }
  break;
}

case 'add-v0-chat': {
  const cfg = getV0Config();
  if (!cfg) { reply({ type: 'error', error: 'v0 not configured' }); break; }
  const chatId = parseChatUrl(msg.chatUrl);
  if (!chatId) { reply({ type: 'error', error: 'Not a v0 chat URL' }); break; }
  try {
    const chat = await getV0Chat(cfg.apiKey, chatId);
    const now = new Date().toISOString();
    addV0Chat(msg.projectId, { chatId: chat.id, label: chat.name, lastUsedAt: now, addedAt: now });
    const project = loadProject(msg.projectId);
    const comments = loadComments(msg.projectId);
    reply({ type: 'project-loaded', projectId: msg.projectId, project, comments });
  } catch (e: any) {
    const code = e instanceof V0Error ? e.code : 'unknown';
    reply({ type: 'error', error: e?.message || 'failed', errorCode: code });
  }
  break;
}

case 'remove-v0-chat': {
  removeV0Chat(msg.projectId, msg.chatId);
  const project = loadProject(msg.projectId);
  const comments = loadComments(msg.projectId);
  reply({ type: 'project-loaded', projectId: msg.projectId, project, comments });
  break;
}

case 'send-to-v0-chat': {
  const cfg = getV0Config();
  if (!cfg) { reply({ type: 'v0-send-result', ok: false, errorCode: 'no_token', errorMessage: 'v0 not configured' }); break; }
  try {
    const result = await sendV0Message(cfg.apiKey, msg.chatId, msg.message);
    touchV0Chat(msg.projectId, msg.chatId);
    // Log AI handoff so the timeline records the event
    logAiInstruction(msg.projectId, msg.commentIds, [], msg.message);
    // Re-broadcast so any open tab sees the updated lastUsedAt
    const project = loadProject(msg.projectId);
    const comments = loadComments(msg.projectId);
    broadcast({ type: 'project-loaded', projectId: msg.projectId, project, comments } as any);
    reply({ type: 'v0-send-result', ok: true, webUrl: result.webUrl });
  } catch (e: any) {
    const code = e instanceof V0Error ? e.code : 'unknown';
    reply({ type: 'v0-send-result', ok: false, errorCode: code, errorMessage: e?.message || 'failed' });
  }
  break;
}
```

(Note: `logAiInstruction` is the existing daemon function the `log-ai-instruction` handler already uses — re-use it.)

- [ ] **Step 3: Build + verify**

Run: `cd daemon && npm run build`
Expected: clean. If `logAiInstruction` import is missing, add it from `./projects.js` (or wherever the existing `log-ai-instruction` handler reads it from — search for the existing `case 'log-ai-instruction':` to find the import).

- [ ] **Step 4: Commit**

```bash
git add daemon/src/server.ts
git commit -m "feat(v0): WS handlers — config, test, add/remove chat, send"
```

---

## Task 8: sync.js wrapper methods

**Files:**
- Modify: `ui-v2/core/sync.js`

- [ ] **Step 1: Add methods inside the `sync` object**

After the existing `testVercelToken` line:

```js
  // ── v0 Platform API ──
  getV0Config() { return send({ type: 'get-v0-config' }); },
  setV0Config(apiKey) { return send({ type: 'set-v0-config', apiKey }); },
  clearV0Config() { return send({ type: 'clear-v0-config' }); },
  testV0Token(apiKey) { return send({ type: 'test-v0-token', apiKey }); },
  addV0Chat(projectId, chatUrl) { return send({ type: 'add-v0-chat', projectId, chatUrl }); },
  removeV0Chat(projectId, chatId) { return send({ type: 'remove-v0-chat', projectId, chatId }); },
  sendToV0Chat(projectId, chatId, message, commentIds) {
    return send({ type: 'send-to-v0-chat', projectId, chatId, message, commentIds });
  },
```

- [ ] **Step 2: Manual smoke**

Run: `cd /Users/carlostarrats/Documents/frank && frank start` (background) — or restart if already running.
In browser console at `localhost:42068`:

```js
const sync = (await import('/core/sync.js')).default;
await sync.getV0Config()
```

Expected: `{ type: 'v0-config', hasKey: false, configuredAt: null, requestId: ... }`

- [ ] **Step 3: Commit**

```bash
git add ui-v2/core/sync.js
git commit -m "feat(v0): sync.js wrappers for v0 WS messages"
```

---

## Task 9: Settings panel — v0 token section

**Files:**
- Modify: `ui-v2/components/settings-panel.js`
- Modify: `ui-v2/styles/app.css` (only if Vercel token section's styles aren't reusable)

- [ ] **Step 1: Find the Vercel deploy token section**

Run: `grep -n "vercel-deploy\|Vercel deploy\|setVercelDeployConfig\|getVercelDeployConfig" ui-v2/components/settings-panel.js`
Read the surrounding ~80 lines — that's the structural template for the v0 section.

- [ ] **Step 2: Add the v0 section**

After the Vercel deploy section, append a parallel block. Markup template:

```html
<section class="settings-section">
  <h3>v0 Platform API</h3>
  <p class="settings-hint">Lets the "Send to v0" button post curated feedback as a follow-up message into an existing v0 chat. Get your key at <a href="https://v0.dev/chat/settings/keys" target="_blank" rel="noopener">v0.dev/chat/settings/keys</a>.</p>
  <div class="settings-status" id="v0-status">…</div>
  <div class="settings-row">
    <input type="password" class="input" id="v0-key" placeholder="v0_..." aria-label="v0 API key">
    <button class="btn-secondary" id="v0-test">Test</button>
    <button class="btn-primary" id="v0-save">Save</button>
    <button class="btn-ghost" id="v0-clear">Clear</button>
  </div>
</section>
```

Wire the buttons (mirror the Vercel pattern in the same file):

```js
async function refreshV0Status() {
  const cfg = await sync.getV0Config();
  const status = document.getElementById('v0-status');
  if (cfg.hasKey) {
    status.textContent = `Configured ${new Date(cfg.configuredAt).toLocaleDateString()}`;
    status.className = 'settings-status configured';
  } else {
    status.textContent = 'Not configured — Send to v0 will fall back to opening v0.dev in a new tab.';
    status.className = 'settings-status';
  }
}
document.getElementById('v0-test').addEventListener('click', async () => {
  const key = document.getElementById('v0-key').value.trim();
  if (!key) { toastError('Paste a key first'); return; }
  const r = await sync.testV0Token(key);
  if (r.ok) toastInfo('v0 accepted the key');
  else toastError('v0 rejected the key');
});
document.getElementById('v0-save').addEventListener('click', async () => {
  const key = document.getElementById('v0-key').value.trim();
  if (!key) { toastError('Paste a key first'); return; }
  await sync.setV0Config(key);
  document.getElementById('v0-key').value = '';
  toastInfo('v0 key saved');
  refreshV0Status();
});
document.getElementById('v0-clear').addEventListener('click', async () => {
  const ok = await showConfirm({ title: 'Clear v0 API key?', confirmLabel: 'Clear', destructive: true });
  if (!ok) return;
  await sync.clearV0Config();
  toastInfo('v0 key cleared');
  refreshV0Status();
});
refreshV0Status();
```

(Adapt names/imports/markup to whatever pattern the Vercel section uses.)

- [ ] **Step 3: Manual smoke**

Open Settings → v0 Platform API section visible. Paste a real v0 key → Test → "v0 accepted the key" toast. Save → status shows "Configured <date>". Clear → status reverts.

- [ ] **Step 4: Commit**

```bash
git add ui-v2/components/settings-panel.js ui-v2/styles/app.css
git commit -m "feat(v0): Settings — v0 API key section"
```

---

## Task 10: Curation — state-aware Send button + chat picker

**Files:**
- Modify: `ui-v2/components/curation.js`
- Modify: `ui-v2/styles/app.css`

This task replaces the existing simple `sendCommentsToV0` button with the full state machine. The deep-link path stays — but only when no token is configured.

- [ ] **Step 1: Cache v0 config on mount**

Inside `renderCuration`, near the existing `cachedCanvasState` cache, add:

```js
let v0HasToken = false;
const refreshV0Token = async () => {
  try { v0HasToken = !!(await sync.getV0Config()).hasKey; } catch { v0HasToken = false; }
  render();
};
refreshV0Token();
```

- [ ] **Step 2: Replace the Send-to-v0 button rendering**

Find the existing `${v0Eligible ? '<button class="btn-secondary" id="batch-v0" …>' : ''}` block in the render closure and replace with:

```js
${v0Eligible ? (() => {
  if (!v0HasToken) {
    return `<button class="btn-secondary" id="batch-v0-deeplink" ${approvedCount === 0 ? 'disabled' : ''} title="${approvedCount === 0 ? 'Approve a comment first' : 'Open v0.dev with the prompt prefilled (configure a v0 API key in Settings for one-click append)'}">Send to v0${approvedCount > 0 ? ` (${approvedCount})` : ''}</button>`;
  }
  const chats = (project.v0Chats ?? []).slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  const target = chats[0];
  if (!target) {
    return `<button class="btn-secondary" id="batch-v0-paste" ${approvedCount === 0 ? 'disabled' : ''} title="${approvedCount === 0 ? 'Approve a comment first' : 'Paste a v0 chat URL to start'}">Send to v0${approvedCount > 0 ? ` (${approvedCount})` : ''}…</button>`;
  }
  return `
    <span class="v0-send-group">
      <button class="btn-secondary v0-send-btn" id="batch-v0-send" ${approvedCount === 0 ? 'disabled' : ''} title="${approvedCount === 0 ? 'Approve a comment first' : `Append ${approvedCount} approved comment${approvedCount === 1 ? '' : 's'} to v0 chat "${target.label}"`}">Send to v0${approvedCount > 0 ? ` (${approvedCount})` : ''} → ${esc(target.label)}</button>
      <button class="btn-secondary v0-picker-btn" id="batch-v0-picker" aria-label="Change v0 chat target" title="Change v0 chat target">⌄</button>
    </span>
  `;
})() : ''}
```

- [ ] **Step 3: Wire the three button states**

Add to the existing handler block (where `#batch-v0` was wired):

```js
// Deep-link fallback (no token configured) — preserves existing behavior
container.querySelector('#batch-v0-deeplink')?.addEventListener('click', (e) => {
  if (e.currentTarget.disabled) return;
  const ids = allComments.filter(c => c.status === 'approved').map(c => c.id);
  if (ids.length === 0) return;
  sendCommentsToV0DeepLink(ids); // renamed from old sendCommentsToV0
});

// Empty-state inline paste form
container.querySelector('#batch-v0-paste')?.addEventListener('click', (e) => {
  if (e.currentTarget.disabled) return;
  showV0PastePopover(e.currentTarget, /* sendAfterAdd */ true, allComments);
});

// One-click append to last-used chat
container.querySelector('#batch-v0-send')?.addEventListener('click', async (e) => {
  if (e.currentTarget.disabled) return;
  const chats = (project.v0Chats ?? []).slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  const target = chats[0];
  if (!target) return;
  const approvedIds = allComments.filter(c => c.status === 'approved').map(c => c.id);
  await sendApprovedToV0Chat(target.chatId, approvedIds);
});

// Picker popover
container.querySelector('#batch-v0-picker')?.addEventListener('click', (e) => {
  e.stopPropagation();
  showV0PickerPopover(e.currentTarget, allComments);
});
```

- [ ] **Step 4: Rename existing function + add new ones**

In the same file:

```js
// (rename the existing sendCommentsToV0 to sendCommentsToV0DeepLink — same body)

// One-click append: format a v0-flavored prompt, hand to daemon, toast result.
async function sendApprovedToV0Chat(chatId, commentIds) {
  const allComments = projectManager.getComments();
  const comments = allComments.filter(c => commentIds.includes(c.id));
  if (comments.length === 0) return;
  const message = formatV0Prompt(comments, allComments);
  const projectId = projectManager.getId();
  let res;
  try {
    res = await sync.sendToV0Chat(projectId, chatId, message, commentIds);
  } catch (e) {
    toastError('Send failed — check daemon connection');
    return;
  }
  if (res.ok) {
    toastInfo(`Sent ${comments.length} comment${comments.length === 1 ? '' : 's'} to v0`, {
      action: { label: 'View in v0', onClick: () => window.open(res.webUrl, '_blank', 'noopener,noreferrer') },
    });
  } else {
    const map = {
      no_token: 'Configure v0 in Settings first',
      invalid_token: 'v0 rejected your API key — re-paste in Settings',
      chat_not_found: 'That v0 chat no longer exists — remove it from the picker',
      rate_limit: 'v0 rate limit hit — try again later',
      network: 'Network error — check your connection',
    };
    toastError(map[res.errorCode] || res.errorMessage || 'Send failed');
  }
}

// Pull the existing prompt-formatting body out of sendCommentsToV0DeepLink
// and expose as a reusable helper. Same body as today minus the toast/window.open.
function formatV0Prompt(comments, allComments) {
  const project = projectManager.get() || {};
  const lines = ['Update the UI to apply this reviewer feedback:', ''];
  let shapeIndex = null;
  if (project.contentType === 'canvas' && cachedCanvasState) {
    shapeIndex = buildShapeIndex(cachedCanvasState);
  }
  for (const c of comments) {
    const pinIdx = allComments.findIndex(x => x.id === c.id);
    const pinNum = pinIdx >= 0 ? pinIdx + 1 : '?';
    const body = (c.remixedText || c.text || '').trim().replace(/\s+/g, ' ');
    let anchor = '';
    if (c.anchor?.type === 'shape') {
      const target = shapeIndex?.get(c.anchor.shapeId);
      anchor = target ? ` (on ${describeShape(target)})` : ` (on shape ${c.anchor.shapeId})`;
    } else if (c.anchor?.cssSelector) {
      anchor = ` (on \`${c.anchor.cssSelector}\`)`;
    }
    lines.push(`- Pin ${pinNum}${anchor}: ${body}`);
  }
  if (project.intent && project.intent.trim()) {
    lines.push('', `Context: ${project.intent.trim()}`);
  }
  if (project.contentType === 'url' && project.url) {
    lines.push('', `Source preview: ${project.url}`);
  }
  return lines.join('\n');
}

function showV0PastePopover(anchorEl, sendAfterAdd, allComments) {
  document.querySelector('.v0-popover')?.remove();
  const pop = document.createElement('div');
  pop.className = 'v0-popover';
  pop.innerHTML = `
    <label class="v0-popover-label">Paste your v0 chat URL</label>
    <input type="text" class="input" placeholder="https://v0.dev/chat/..." />
    <div class="v0-popover-actions">
      <button class="btn-ghost v0-cancel">Cancel</button>
      <button class="btn-primary v0-add">Add ${sendAfterAdd ? '& Send' : 'chat'}</button>
    </div>
  `;
  positionPopover(pop, anchorEl);
  document.body.appendChild(pop);
  const input = pop.querySelector('input');
  input.focus();
  pop.querySelector('.v0-cancel').addEventListener('click', () => pop.remove());
  pop.querySelector('.v0-add').addEventListener('click', async () => {
    const url = input.value.trim();
    if (!url) return;
    const projectId = projectManager.getId();
    let res;
    try { res = await sync.addV0Chat(projectId, url); } catch (e) {
      toastError('Failed to validate chat URL'); return;
    }
    if (res.type === 'error') {
      toastError(res.error || 'Invalid chat URL');
      return;
    }
    pop.remove();
    if (sendAfterAdd) {
      const chat = (res.project.v0Chats ?? []).slice(-1)[0];
      const approvedIds = allComments.filter(c => c.status === 'approved').map(c => c.id);
      await sendApprovedToV0Chat(chat.chatId, approvedIds);
    } else {
      toastInfo('v0 chat added');
    }
  });
  document.addEventListener('click', function close(e) {
    if (!pop.contains(e.target) && e.target !== anchorEl) {
      pop.remove();
      document.removeEventListener('click', close);
    }
  });
}

function showV0PickerPopover(anchorEl, allComments) {
  document.querySelector('.v0-popover')?.remove();
  const project = projectManager.get();
  const chats = (project.v0Chats ?? []).slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  const pop = document.createElement('div');
  pop.className = 'v0-popover';
  pop.innerHTML = `
    <label class="v0-popover-label">Send to which v0 chat?</label>
    <ul class="v0-chat-list">
      ${chats.map(c => `
        <li data-chat-id="${esc(c.chatId)}">
          <button class="v0-chat-pick">${esc(c.label)}</button>
          <button class="v0-chat-remove" aria-label="Remove">✕</button>
        </li>
      `).join('')}
    </ul>
    <button class="btn-ghost v0-add-chat">+ Add another chat</button>
  `;
  positionPopover(pop, anchorEl);
  document.body.appendChild(pop);
  pop.querySelectorAll('.v0-chat-pick').forEach(btn => {
    btn.addEventListener('click', async () => {
      const chatId = btn.closest('li').dataset.chatId;
      pop.remove();
      const approvedIds = allComments.filter(c => c.status === 'approved').map(c => c.id);
      await sendApprovedToV0Chat(chatId, approvedIds);
    });
  });
  pop.querySelectorAll('.v0-chat-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const chatId = btn.closest('li').dataset.chatId;
      const ok = await showConfirm({ title: 'Remove this v0 chat from the project?', confirmLabel: 'Remove' });
      if (!ok) return;
      await sync.removeV0Chat(projectManager.getId(), chatId);
      pop.remove();
    });
  });
  pop.querySelector('.v0-add-chat').addEventListener('click', () => {
    pop.remove();
    showV0PastePopover(anchorEl, false, allComments);
  });
  document.addEventListener('click', function close(e) {
    if (!pop.contains(e.target) && e.target !== anchorEl) {
      pop.remove();
      document.removeEventListener('click', close);
    }
  });
}

function positionPopover(pop, anchorEl) {
  const r = anchorEl.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = `${r.bottom + 4}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 280, r.left))}px`;
}
```

- [ ] **Step 5: Add styles**

Append to `ui-v2/styles/app.css`:

```css
.v0-send-group { display: inline-flex; gap: 0; }
.v0-send-group .v0-send-btn { border-top-right-radius: 0; border-bottom-right-radius: 0; }
.v0-send-group .v0-picker-btn { border-top-left-radius: 0; border-bottom-left-radius: 0; padding: 0 8px; min-width: 28px; border-left: 1px solid var(--border); }
.v0-popover { z-index: 300; min-width: 280px; max-width: 360px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 8px; }
.v0-popover-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
.v0-popover-actions { display: flex; gap: 8px; justify-content: flex-end; }
.v0-chat-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.v0-chat-list li { display: flex; align-items: center; gap: 4px; }
.v0-chat-pick { flex: 1; text-align: left; background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 6px 8px; font: inherit; color: inherit; cursor: pointer; }
.v0-chat-pick:hover { background: var(--bg-hover); }
.v0-chat-remove { background: transparent; border: 0; color: var(--text-muted); cursor: pointer; padding: 4px 8px; }
.v0-chat-remove:hover { color: var(--destructive); }
```

- [ ] **Step 6: Commit**

```bash
git add ui-v2/components/curation.js ui-v2/styles/app.css
git commit -m "feat(v0): state-aware Send button + chat target picker"
```

---

## Task 11: Update help-panel copy

**Files:**
- Modify: `ui-v2/components/help-panel.js`

- [ ] **Step 1: Find existing v0 mention**

Run: `grep -n "v0\|Send to v0" ui-v2/components/help-panel.js`

- [ ] **Step 2: Update the AI routing entry**

Replace the existing sentence about v0 with:

```
URL and canvas projects also get a "Send to v0" button: configure a v0 API key in Settings to append curated feedback as a follow-up message in an existing v0 chat, or leave it unset to open v0.dev with the prompt prefilled in a new tab.
```

- [ ] **Step 3: Commit**

```bash
git add ui-v2/components/help-panel.js
git commit -m "docs(help): explain v0 API + deep-link modes"
```

---

## Task 12: Manual smoke test against real v0 account

This task isn't TDD — it's the "phase isn't complete until the end-to-end flow works against a real deployment" requirement from CLAUDE.md.

- [ ] **Step 1: Restart daemon** to pick up the rebuilt dist

Run: `cd daemon && npm run build && pkill -f 'frank' || true && cd .. && frank start &`

- [ ] **Step 2: Configure a real v0 token**

Open Settings → v0 Platform API. Paste a real key from `v0.dev/chat/settings/keys`. Click Test → expect "accepted" toast. Click Save → expect "Configured <date>".

- [ ] **Step 3: First-Send flow on a URL project**

Open a URL project with at least one approved comment. Confirm button reads `Send to v0…` (ellipsis). Click → paste form appears. Paste a real v0 chat URL → Add & Send. Expect:
- Toast: `Sent N comment(s) to v0` with "View in v0" action
- Click "View in v0" → opens that exact chat in a new tab; the curated feedback is the latest message
- Reload Frank — button now reads `Send to v0 (N) → <chat name>`

- [ ] **Step 4: One-click append**

Approve another comment. Click the Send button (no chevron). Expect:
- Toast immediately (<1s)
- v0 chat shows new follow-up

- [ ] **Step 5: Picker — switch chat**

Click chevron → popover. Click "+ Add another chat" → paste a different chat URL → Add chat. Reopen picker → both chats listed. Click the second one → message goes there. Reload — button now defaults to the second one (most recent).

- [ ] **Step 6: Picker — remove chat**

Open picker → ✕ on first chat → Confirm. Reopen picker — only second chat remains.

- [ ] **Step 7: Error paths**

In Settings, paste an invalid token → Test should say rejected. In picker, manually edit `v0Chats` JSON in `~/.frank/projects/<id>/project.json` to a fake chatId → click Send → toast: "That v0 chat no longer exists — remove it from the picker".

- [ ] **Step 8: Fallback path**

Settings → Clear v0 key → confirm. Project's button now reads `Send to v0` (no arrow, no ellipsis). Click → opens v0.dev/chat?q=… in new tab (existing deep-link behavior).

- [ ] **Step 9: Switch projects**

Open a different project that has its own v0 chats — confirm button shows that project's last-used chat, not the previous project's. No global state leakage.

- [ ] **Step 10: Commit (if any cleanup tweaks needed)**

```bash
git add -A
git commit -m "fix(v0): smoke-test cleanup"  # only if smoke surfaced issues
```

---

## Self-review summary

- **Spec coverage:** Every requirement from the conversation is mapped — token in Settings (Task 9), per-project chat list (Task 6 + protocol Task 1), state-aware button (Task 10), picker with last-used default (Task 10), project-scoped not global (Task 6 schema + Task 12 step 9), deep-link fallback when no token (Task 10 first branch), error mapping (Task 5 + Task 10).
- **No placeholders:** All steps have full code or full commands. The one "find/replace" step (Task 9 step 1) points to a specific grep pattern + the parallel structural template.
- **Type consistency:** `V0ChatTarget` fields used in protocol.ts (Task 1), projects.ts (Task 6), server.ts (Task 7), and the UI (Task 10) all reference `chatId`, `label`, `lastUsedAt`, `addedAt`. `V0SendResponse` errorCodes match those returned by `V0Error` in `v0.ts`.
