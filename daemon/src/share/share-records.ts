// Local persistence of URL-share records so users can revoke after the
// popover that created them has closed. Records live at
// ~/.frank/share-records.json as a JSON array — simpler than a DB, works
// offline, mode 0600 to match config.json.
//
// This module is the sole writer of the file. Atomic-write (write to .tmp,
// rename) to prevent partial writes on crash.

import * as fs from 'fs';
import * as path from 'path';
import { FRANK_DIR } from '../protocol.js';

export interface UrlShareRecord {
  /** Frank-cloud share id — the canonical identifier. Primary key. */
  shareId: string;
  /** Token required to revoke the share-link + deployment. */
  revokeToken: string;
  /** Vercel deployment id (for revoke's Vercel-side delete). */
  vercelDeploymentId: string;
  /** Team id, when the user's Vercel token is team-scoped. */
  vercelTeamId?: string;
  /** The running preview URL a reviewer opens. */
  deploymentUrl: string;
  /** Frank-cloud indirection URL (the canonical share link). */
  shareUrl: string;
  /** Project id this share belongs to. */
  projectId: string;
  /** ISO timestamp when the share was created. */
  createdAt: string;
  /** ISO timestamp when the share expires. */
  expiresAt: string;
  /** Project directory on disk that was bundled. */
  projectDir: string;
  /** Set when revoke has been attempted. */
  revokedAt?: string;
  /** Revoke outcome — mirrors the shape returned by share-revoke-url. */
  revoke?: {
    linkInvalidated: boolean;
    vercelDeleted: boolean;
    cloudError?: string;
    vercelError?: string;
  };
}

// Evaluated lazily (not at import time) so tests can mock FRANK_DIR.
function recordsPath(): string {
  return path.join(FRANK_DIR, 'share-records.json');
}

function readAll(): UrlShareRecord[] {
  try {
    const raw = fs.readFileSync(recordsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as UrlShareRecord[];
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeAll(records: UrlShareRecord[]): void {
  fs.mkdirSync(FRANK_DIR, { recursive: true });
  const target = recordsPath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/**
 * Append a new share record. If a record with the same shareId already
 * exists (shouldn't happen in normal flow — shareIds are generated fresh),
 * it's replaced so we don't grow duplicates over time.
 */
export function writeShareRecord(record: UrlShareRecord): void {
  const records = readAll();
  const idx = records.findIndex((r) => r.shareId === record.shareId);
  if (idx >= 0) records[idx] = record;
  else records.push(record);
  writeAll(records);
}

/**
 * List records, newest first. Filters:
 *   - projectId: only records for that project.
 *   - includeRevoked: defaults to false (hide revoked ones from the UI;
 *     they still live on disk for audit).
 *   - includeExpired: defaults to false (same reason).
 */
export function listShareRecords(opts: {
  projectId?: string;
  includeRevoked?: boolean;
  includeExpired?: boolean;
} = {}): UrlShareRecord[] {
  const records = readAll();
  const now = new Date().toISOString();
  const filtered = records.filter((r) => {
    if (opts.projectId && r.projectId !== opts.projectId) return false;
    if (!opts.includeRevoked && r.revokedAt) return false;
    if (!opts.includeExpired && r.expiresAt < now) return false;
    return true;
  });
  // Newest first.
  filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return filtered;
}

/**
 * Mark a record as revoked. `result` mirrors the shape returned by the
 * share-revoke-url handler. The record is kept on disk (revokedAt set)
 * rather than deleted — useful for audit + debugging.
 */
export function markRecordRevoked(
  shareId: string,
  result: NonNullable<UrlShareRecord['revoke']>,
): void {
  const records = readAll();
  const idx = records.findIndex((r) => r.shareId === shareId);
  if (idx < 0) return;
  records[idx] = {
    ...records[idx],
    revokedAt: new Date().toISOString(),
    revoke: result,
  };
  writeAll(records);
}

/**
 * Drop records whose expiresAt is more than `retentionDays` past the
 * expiry. Default 30 days. Called on daemon startup alongside
 * `purgeExpiredTrash` to keep the file from growing unbounded.
 */
export function purgeExpiredRecords(retentionDays: number = 30): number {
  const records = readAll();
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
  const kept = records.filter((r) => r.expiresAt >= cutoff);
  const dropped = records.length - kept.length;
  if (dropped > 0) writeAll(kept);
  return dropped;
}

// Exported for tests.
export { recordsPath as shareRecordsPath };
