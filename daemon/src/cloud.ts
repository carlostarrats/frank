import fs from 'fs';
import { CONFIG_PATH } from './protocol.js';

interface CloudConfig {
  url: string;
  apiKey: string;
}

export interface AiConversationLimits {
  softWarnBytes: number;
  hardCapBytes: number;
  softWarnMessages: number;
  hardCapMessages: number;
}

const DEFAULT_AI_CONVERSATION_LIMITS: AiConversationLimits = {
  softWarnBytes: 2 * 1024 * 1024,   // 2 MB
  hardCapBytes: 5 * 1024 * 1024,    // 5 MB
  softWarnMessages: 100,
  hardCapMessages: 200,
};

function readRawConfig(): Record<string, unknown> {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

// Any file that contains a secret gets 0600 on write. The API key and cloud
// token live here — never weaken this.
function writeConfigSecure(config: Record<string, unknown>): void {
  const dir = CONFIG_PATH.replace(/\/[^/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = CONFIG_PATH + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tmpPath, 0o600); } catch { /* already set via mode */ }
  fs.renameSync(tmpPath, CONFIG_PATH);
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* best effort */ }
}

function loadConfig(): CloudConfig | null {
  const config = readRawConfig();
  if (!config.cloudUrl || !config.apiKey) return null;
  return { url: config.cloudUrl as string, apiKey: config.apiKey as string };
}

export function saveCloudConfig(cloudUrl: string, apiKey: string): void {
  const config = readRawConfig();
  config.cloudUrl = cloudUrl;
  config.apiKey = apiKey;
  config.cloudConfiguredAt = new Date().toISOString();
  writeConfigSecure(config);
}

export function getCloudConfiguredAt(): string | null {
  const config = readRawConfig();
  return (config.cloudConfiguredAt as string) || null;
}

export function getClaudeApiKey(): string | null {
  const config = readRawConfig();
  const providers = (config.aiProviders || {}) as Record<string, { apiKey?: string }>;
  return providers.claude?.apiKey || null;
}

export function setClaudeApiKey(apiKey: string): void {
  const config = readRawConfig();
  const providers = (config.aiProviders || {}) as Record<string, unknown>;
  providers.claude = { apiKey };
  config.aiProviders = providers;
  writeConfigSecure(config);
}

export function clearClaudeApiKey(): void {
  const config = readRawConfig();
  const providers = (config.aiProviders || {}) as Record<string, unknown>;
  delete providers.claude;
  config.aiProviders = providers;
  writeConfigSecure(config);
}

export function getAiConversationLimits(): AiConversationLimits {
  const config = readRawConfig();
  const stored = (config.aiConversations || {}) as Partial<AiConversationLimits>;
  return { ...DEFAULT_AI_CONVERSATION_LIMITS, ...stored };
}

export function isCloudConnected(): boolean {
  return loadConfig() !== null;
}

export function getCloudUrl(): string | null {
  return loadConfig()?.url || null;
}

export async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
  const config = loadConfig();
  if (!config) return { ok: false, error: 'Not connected. Run: frank connect <url> --key <key>' };

  try {
    const res = await fetch(`${config.url}/api/health`, {
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
    });
    const data = await res.json();
    return data.status === 'ok' ? { ok: true } : { ok: false, error: data.message || 'Unknown error' };
  } catch (e: any) {
    return { ok: false, error: `Cannot reach ${config.url}: ${e.message}` };
  }
}

export async function uploadShare(
  snapshot: unknown,
  coverNote: string,
  contentType: string,
  oldShareId?: string,
  oldRevokeToken?: string,
  expiryDays?: number,
): Promise<{ shareId: string; revokeToken: string; url: string } | { error: string }> {
  const config = loadConfig();
  if (!config) return { error: 'Not connected to cloud' };

  try {
    const res = await fetch(`${config.url}/api/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ snapshot, coverNote, contentType, oldShareId, oldRevokeToken, ...(expiryDays !== undefined ? { expiryDays } : {}) }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error };
    return {
      shareId: data.shareId,
      revokeToken: data.revokeToken,
      url: `${config.url}${data.url}`,
    };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function fetchShareComments(shareId: string): Promise<Array<{ id: string; author: string; screenId: string; anchor: unknown; text: string; ts: string }>> {
  const config = loadConfig();
  if (!config) return [];

  try {
    const res = await fetch(`${config.url}/api/share?id=${encodeURIComponent(shareId)}`);
    const data = await res.json();
    if (data.error) return [];
    return data.comments || [];
  } catch {
    return [];
  }
}

// ─── v3 live-share client ───────────────────────────────────────────────────

// Session-scoped "this backend doesn't speak v3" marker. Set on 404 from a
// v3-only endpoint, cleared on any 2xx from one. The 5-minute TTL makes the
// system self-healing if the user redeploys mid-session without restarting
// the daemon.
const V2_ONLY_TTL_MS = 5 * 60 * 1000;
let v2OnlyUntil = 0;

export function markBackendV2Only(): void {
  v2OnlyUntil = Date.now() + V2_ONLY_TTL_MS;
}

export function clearV2OnlyMarker(): void {
  v2OnlyUntil = 0;
}

export function isBackendV2Only(): boolean {
  return Date.now() < v2OnlyUntil;
}

export interface AuthorStreamHandlers {
  onComment?: (comment: unknown) => void;
  onPresence?: (ev: { viewers: number }) => void;
  onShareEnded?: (ev: { reason: 'revoked' | 'expired' }) => void;
  onReconnect?: () => void;
  onClose?: () => void;
  onError?: (err: string) => void;
}

export interface AuthorStreamHandle {
  close(): void;
}

export function openAuthorStream(shareId: string, handlers: AuthorStreamHandlers): AuthorStreamHandle {
  const config = loadConfig();
  if (!config) {
    handlers.onError?.('Not connected to cloud');
    return { close() {} };
  }

  const cfg: CloudConfig = config;
  let closed = false;
  let controller: AbortController | null = null;
  let backoffMs = 500;

  async function loop() {
    while (!closed) {
      controller = new AbortController();
      try {
        const res = await fetch(`${cfg.url}/api/share/${shareId}/author-stream`, {
          headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Accept': 'text/event-stream',
          },
          signal: controller.signal,
        });
        if (res.status === 404) {
          markBackendV2Only();
          handlers.onError?.('v2-only-backend');
          return; // do not reconnect
        }
        if (!res.ok || !res.body) {
          if (res.status === 410) {
            handlers.onShareEnded?.({ reason: 'expired' });
            return;
          }
          handlers.onError?.(`author-stream HTTP ${res.status}`);
          await sleep(backoffMs);
          backoffMs = Math.min(backoffMs * 2, 10_000);
          continue;
        }
        clearV2OnlyMarker();
        handlers.onReconnect?.();
        backoffMs = 500;
        await readSse(res.body, handlers);
      } catch (e: any) {
        if (closed) return;
        handlers.onError?.(e.message || String(e));
      }
      handlers.onClose?.();
      if (closed) return;
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, 10_000);
    }
  }
  void loop();

  return {
    close() {
      closed = true;
      controller?.abort();
    },
  };
}

async function readSse(body: ReadableStream<Uint8Array>, handlers: AuthorStreamHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = '';
  let data = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line === '') {
        // Dispatch.
        if (event && data) {
          try {
            const parsed = JSON.parse(data);
            if (event === 'comment') handlers.onComment?.(parsed);
            else if (event === 'presence') handlers.onPresence?.(parsed);
            else if (event === 'share-ended') handlers.onShareEnded?.(parsed);
          } catch { /* ignore malformed frame */ }
        }
        event = '';
        data = '';
        continue;
      }
      if (line.startsWith(':')) continue; // keep-alive comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
      // id: lines intentionally ignored — author always reads the live tail.
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function postState(
  shareId: string,
  body: { revision: number; type: 'state' | 'diff'; payload: unknown },
): Promise<{ acceptedRevision: number } | { error: string; currentRevision?: number; httpStatus?: number }> {
  const config = loadConfig();
  if (!config) return { error: 'Not connected to cloud' };
  if (isBackendV2Only()) {
    return { error: 'v2-only-backend', httpStatus: 404 };
  }
  try {
    const res = await fetch(`${config.url}/api/share/${shareId}/state`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 404) {
      markBackendV2Only();
      return { error: 'v2-only-backend', httpStatus: 404 };
    }
    const data = await res.json();
    if (!res.ok) {
      return { error: data.error || `HTTP ${res.status}`, currentRevision: data.currentRevision, httpStatus: res.status };
    }
    clearV2OnlyMarker();
    return { acceptedRevision: data.acceptedRevision };
  } catch (e: any) {
    return { error: e.message };
  }
}

export async function revokeShare(shareId: string, revokeToken: string): Promise<{ ok: boolean; error?: string }> {
  const config = loadConfig();
  if (!config) return { ok: false, error: 'Not connected to cloud' };
  try {
    const res = await fetch(`${config.url}/api/share?id=${encodeURIComponent(shareId)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'X-Frank-Revoke-Token': revokeToken,
      },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
