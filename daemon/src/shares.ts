import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const SHARES_DIR = path.join(process.env.HOME || '', '.frank', 'shares');

function ensureSharesDir(): void {
  fs.mkdirSync(SHARES_DIR, { recursive: true });
}

function generateId(): string {
  return crypto.randomBytes(9).toString('base64url').slice(0, 12);
}

export function createShare(project: unknown, coverNote: string, oldRevokeToken?: string, oldShareId?: string): { shareId: string; revokeToken: string; url: string } {
  ensureSharesDir();

  // Revoke old share if provided
  if (oldShareId && oldRevokeToken) {
    const oldPath = path.join(SHARES_DIR, `${oldShareId}.json`);
    if (fs.existsSync(oldPath)) {
      try {
        const old = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
        if (old.revokeToken === oldRevokeToken) {
          fs.unlinkSync(oldPath);
        }
      } catch { /* ignore */ }
    }
  }

  const shareId = generateId();
  const revokeToken = generateId();
  const share = {
    project,
    coverNote: coverNote || '',
    notes: [] as unknown[],
    revokeToken,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const filePath = path.join(SHARES_DIR, `${shareId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(share, null, 2), 'utf8');

  return { shareId, revokeToken, url: `/viewer/?id=${shareId}` };
}

interface ShareData {
  project: unknown;
  notes: Array<{ id: string; screenId: string; section: number | null; author: string; text: string; ts: string }>;
  coverNote: string;
  metadata: { createdAt: string; expiresAt: string };
}

interface ShareError {
  error: string;
  message?: string;
}

export function getShare(shareId: string): ShareData | ShareError {
  ensureSharesDir();
  const filePath = path.join(SHARES_DIR, `${shareId}.json`);

  if (!fs.existsSync(filePath)) {
    return { error: 'not found' };
  }

  try {
    const share = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (new Date(share.expiresAt) < new Date()) {
      return { error: 'expired', message: 'This prototype has been updated. Ask the owner for the new link.' };
    }

    return {
      project: share.project,
      notes: share.notes || [],
      coverNote: share.coverNote || '',
      metadata: { createdAt: share.createdAt, expiresAt: share.expiresAt },
    };
  } catch {
    return { error: 'not found' };
  }
}

interface NoteInput {
  screenId: string;
  section: number | null;
  author: string;
  text: string;
}

export function addNote(shareId: string, note: NoteInput): { note: unknown } | { error: string } {
  ensureSharesDir();
  const filePath = path.join(SHARES_DIR, `${shareId}.json`);

  if (!fs.existsSync(filePath)) return { error: 'not found' };

  try {
    const share = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    if (new Date(share.expiresAt) < new Date()) return { error: 'expired' };
    if ((share.notes || []).length >= 100) return { error: 'max notes reached' };
    if (note.text.length > 2000) return { error: 'note too long' };

    const newNote = {
      id: 'n' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
      screenId: note.screenId,
      section: note.section,
      author: note.author,
      text: note.text,
      ts: new Date().toISOString(),
    };

    share.notes = share.notes || [];
    share.notes.push(newNote);
    fs.writeFileSync(filePath, JSON.stringify(share, null, 2), 'utf8');

    return { note: newNote };
  } catch {
    return { error: 'read error' };
  }
}

export function readShareFile(shareId: string): { notes?: Array<{ id: string; screenId: string; section: number | null; author: string; text: string; ts: string }>; [key: string]: unknown } | null {
  const filePath = path.join(SHARES_DIR, `${shareId}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}
