import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';

export interface CanvasLivePayload {
  canvasState: string;
  assets: Record<string, string>;
}

// Matches the URL shape produced by assets.ts::saveAsset.
const ASSET_URL_RE = /^\/files\/projects\/[^/]+\/assets\/([a-zA-Z0-9_.-]+)$/;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeForFile(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] || null : null;
}

function collectAssetUrls(node: unknown, out: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const n = node as { className?: string; attrs?: { assetUrl?: string }; children?: unknown[] };
  if (n.className === 'Image' && typeof n.attrs?.assetUrl === 'string') {
    out.add(n.attrs.assetUrl);
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) collectAssetUrls(child, out);
  }
}

function resolveAssetPath(url: string): string | null {
  if (!ASSET_URL_RE.test(url)) return null;
  const segments = url.split('/');
  // Expected: ['', 'files', 'projects', '<id>', 'assets', '<filename>']
  if (segments.length !== 6) return null;
  const projectId = segments[3];
  const filename = segments[5];
  return path.join(PROJECTS_DIR, projectId, 'assets', filename);
}

export async function buildCanvasLivePayload(projectId: string): Promise<CanvasLivePayload | null> {
  const statePath = path.join(PROJECTS_DIR, projectId, 'canvas-state.json');
  if (!fs.existsSync(statePath)) return null;

  const canvasState = fs.readFileSync(statePath, 'utf8');
  let parsed: unknown;
  try { parsed = JSON.parse(canvasState); } catch { return null; }

  const urls = new Set<string>();
  collectAssetUrls(parsed, urls);

  const assets: Record<string, string> = {};
  for (const url of urls) {
    const p = resolveAssetPath(url);
    if (!p || !fs.existsSync(p)) continue;
    const mime = mimeForFile(p);
    if (!mime) continue;
    try {
      const bytes = fs.readFileSync(p);
      assets[url] = `data:${mime};base64,${bytes.toString('base64')}`;
    } catch { /* skip unreadable files */ }
  }

  return { canvasState, assets };
}
