import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR, type Comment } from './protocol.js';

export interface CurationEntry {
  id: string;
  commentIds: string[];
  action: 'approve' | 'dismiss' | 'remix' | 'batch' | 'reset';
  originalTexts: string[];
  remixedText: string;
  dismissReason: string;
  ts: string;
}

function curationPath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'curation.json');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function loadCurations(projectId: string): CurationEntry[] {
  const p = curationPath(projectId);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}

export function addCuration(
  projectId: string,
  commentIds: string[],
  action: 'approve' | 'dismiss' | 'remix' | 'batch' | 'reset',
  originalTexts: string[],
  remixedText: string = '',
  dismissReason: string = ''
): CurationEntry {
  const curations = loadCurations(projectId);
  const entry: CurationEntry = {
    id: 'cur-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    commentIds,
    action,
    originalTexts,
    remixedText,
    dismissReason,
    ts: new Date().toISOString(),
  };
  curations.push(entry);
  atomicWrite(curationPath(projectId), JSON.stringify(curations, null, 2));
  return entry;
}

// Update comment statuses based on curation action
export function applyCurationToComments(
  projectId: string,
  commentIds: string[],
  newStatus: 'approved' | 'dismissed' | 'remixed' | 'pending'
): void {
  const commentsPath = path.join(PROJECTS_DIR, projectId, 'comments.json');
  if (!fs.existsSync(commentsPath)) return;
  const comments = JSON.parse(fs.readFileSync(commentsPath, 'utf8')) as Comment[];
  const idSet = new Set(commentIds);
  for (const c of comments) {
    if (idSet.has(c.id)) c.status = newStatus;
  }
  atomicWrite(commentsPath, JSON.stringify(comments, null, 2));
}
