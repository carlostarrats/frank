import fs from 'fs';
import { CONFIG_PATH } from './protocol.js';

interface CloudConfig {
  url: string;
  apiKey: string;
}

function loadConfig(): CloudConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    if (!config.cloudUrl || !config.apiKey) return null;
    return { url: config.cloudUrl, apiKey: config.apiKey };
  } catch {
    return null;
  }
}

export function saveCloudConfig(cloudUrl: string, apiKey: string): void {
  let config: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch { /* start fresh */ }
  config.cloudUrl = cloudUrl;
  config.apiKey = apiKey;
  const dir = CONFIG_PATH.replace(/\/[^/]+$/, '');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
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
