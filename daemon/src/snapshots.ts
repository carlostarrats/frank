import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR } from './protocol.js';

export interface SnapshotMeta {
  id: string;
  trigger: 'manual' | 'share' | 'ai-applied';
  triggeredBy: string | null;
  starred: boolean;
  label: string;
  frankVersion: string;
  ts: string;
}

function snapshotsDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'snapshots');
}

function snapshotDir(projectId: string, snapshotId: string): string {
  return path.join(snapshotsDir(projectId), snapshotId);
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function saveSnapshot(
  projectId: string,
  html: string,
  screenshotBase64: string | null,
  trigger: 'manual' | 'share' | 'ai-applied',
  triggeredBy: string | null = null
): SnapshotMeta {
  const id = 'snap-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex');
  const dir = snapshotDir(projectId, id);
  fs.mkdirSync(dir, { recursive: true });

  const meta: SnapshotMeta = {
    id,
    trigger,
    triggeredBy,
    starred: false,
    label: '',
    frankVersion: '2',
    ts: new Date().toISOString(),
  };

  atomicWrite(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  atomicWrite(path.join(dir, 'snapshot.html'), html);

  if (screenshotBase64) {
    const buf = Buffer.from(screenshotBase64, 'base64');
    fs.writeFileSync(path.join(dir, 'screenshot.png'), buf);
  }

  return meta;
}

export function listSnapshots(projectId: string): SnapshotMeta[] {
  const dir = snapshotsDir(projectId);
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const snapshots: SnapshotMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(dir, entry.name, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      snapshots.push(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
    } catch { /* skip corrupt */ }
  }

  return snapshots.sort((a, b) => b.ts.localeCompare(a.ts));
}

export function starSnapshot(projectId: string, snapshotId: string, label: string): SnapshotMeta | null {
  const metaPath = path.join(snapshotDir(projectId, snapshotId), 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SnapshotMeta;
  meta.starred = true;
  meta.label = label;
  atomicWrite(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

export function unstarSnapshot(projectId: string, snapshotId: string): SnapshotMeta | null {
  const metaPath = path.join(snapshotDir(projectId, snapshotId), 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as SnapshotMeta;
  meta.starred = false;
  meta.label = '';
  atomicWrite(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

export function deleteSnapshot(projectId: string, snapshotId: string): boolean {
  const dir = snapshotDir(projectId, snapshotId);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
