// assets.ts — Content-addressed binary storage per project.
//
// Used for canvas image drops and (soon) comment image attachments. Assets
// live at ~/.frank/projects/{id}/assets/{sha}.{ext}, served to the browser via
// the existing /files/ HTTP route. Filename derivation is sha256(bytes) so
// duplicate uploads share a single file.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR } from './protocol.js';

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
};

export const ALLOWED_MIME_TYPES = Object.keys(MIME_EXT);

export interface SavedAsset {
  assetId: string;        // sha256 digest
  filename: string;       // {sha}.{ext}
  relativePath: string;   // projects/{id}/assets/{filename} — passes to /files/
  url: string;            // absolute-from-daemon path (/files/...)
  bytes: number;
}

function extForMime(mime: string): string {
  const ext = MIME_EXT[mime.toLowerCase()];
  if (!ext) throw new Error(`Unsupported asset mime type: ${mime}`);
  return ext;
}

function assetsDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'assets');
}

export function saveAsset(projectId: string, buffer: Buffer, mimeType: string): SavedAsset {
  const ext = extForMime(mimeType);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const filename = `${sha}.${ext}`;
  const dir = assetsDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    const tmp = filePath + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, filePath);
  }
  const relativePath = `projects/${projectId}/assets/${filename}`;
  return {
    assetId: sha,
    filename,
    relativePath,
    url: `/files/${encodeURI(relativePath)}`,
    bytes: buffer.length,
  };
}
