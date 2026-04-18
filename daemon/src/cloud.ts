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
  writeConfigSecure(config);
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
      body: JSON.stringify({ snapshot, coverNote, contentType, oldShareId, oldRevokeToken }),
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
