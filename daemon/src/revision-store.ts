import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';

interface LiveFile {
  revision: number;
  lastPush: string | null;
}

function livePath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'live.json');
}

function read(projectId: string): LiveFile {
  try {
    const raw = fs.readFileSync(livePath(projectId), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LiveFile>;
    return {
      revision: Number.isFinite(parsed.revision) ? (parsed.revision as number) : 0,
      lastPush: typeof parsed.lastPush === 'string' ? parsed.lastPush : null,
    };
  } catch {
    return { revision: 0, lastPush: null };
  }
}

function writeAtomic(projectId: string, data: LiveFile): void {
  const p = livePath(projectId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

export function loadRevision(projectId: string): number {
  return read(projectId).revision;
}

export function saveRevision(projectId: string, revision: number): void {
  const current = read(projectId);
  // Never regress: accept only equal-or-greater values. The "backend is ahead"
  // case still lands here because the daemon fast-forwards explicitly.
  if (revision < current.revision) return;
  writeAtomic(projectId, { revision, lastPush: new Date().toISOString() });
}

export function nextRevision(projectId: string): number {
  const current = read(projectId);
  const next = current.revision + 1;
  writeAtomic(projectId, { revision: next, lastPush: new Date().toISOString() });
  return next;
}
