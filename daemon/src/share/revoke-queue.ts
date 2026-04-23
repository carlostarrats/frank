// Revoke retry queue. Implements Item 6 + design doc §7.2.
//
// When a user revokes a share:
//   1. Cloud flag flips synchronously (share link dead within ms).
//   2. Vercel DELETE fires once synchronously.
//   3. If the Vercel delete fails (network, Vercel 5xx, rate limit),
//      the failure is enqueued here. A background worker then retries
//      with exponential backoff — 1min → 5min → 30min → 1h → 6h → 24h.
//
// Rationale: the privacy story hinges on the share link dying instantly
// and the Vercel deployment being cleaned up eventually. Leaving the
// deployment live for hours while the user has to remember to manually
// retry is hostile. The 24h ceiling is enough that most outages resolve
// inside it; after that we mark the entry as giving-up so the UI can
// surface it for manual intervention.
//
// Storage: ~/.frank/revoke-queue.json — mirror of share-records.ts.
// Atomic write via .tmp + rename. Mode 0600.

import * as fs from 'fs';
import * as path from 'path';
import { FRANK_DIR } from '../protocol.js';

export interface RevokeQueueEntry {
  shareId: string;
  vercelDeploymentId: string;
  vercelTeamId?: string;
  /** When the user first clicked Revoke (the initial sync attempt failed). */
  firstAttemptAt: string;
  /** When the next retry should fire (ISO). The worker sleeps until this time. */
  nextAttemptAt: string;
  /** Number of retries so far (the initial sync attempt is NOT counted; this
   *  starts at 0 and increments before each retry. After BACKOFF_STEPS.length
   *  retries we stop retrying and mark the entry as given-up. */
  attemptCount: number;
  /** Last error string from a failed attempt (Vercel response text, timeout, etc). */
  lastError?: string;
  /** Set when the queue has burned through all retry steps and we've
   *  given up. The entry stays on disk so the UI can surface it; user
   *  can manually delete the deployment from the Vercel dashboard. */
  gaveUpAt?: string;
}

/** Exponential-ish backoff steps in MINUTES per design doc §7.2. */
export const BACKOFF_STEPS_MINUTES = [1, 5, 30, 60, 360, 1440];

function queuePath(): string {
  return path.join(FRANK_DIR, 'revoke-queue.json');
}

function readAll(): RevokeQueueEntry[] {
  try {
    const raw = fs.readFileSync(queuePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RevokeQueueEntry[];
  } catch (err: any) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function writeAll(entries: RevokeQueueEntry[]): void {
  fs.mkdirSync(FRANK_DIR, { recursive: true });
  const target = queuePath();
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, target);
}

/**
 * Compute the next-attempt timestamp given how many retries have already
 * been tried. `attemptCount === 0` → first retry uses BACKOFF_STEPS[0].
 * Returns null when we've exhausted the schedule (caller should mark the
 * entry gave-up instead of rescheduling).
 */
export function nextAttemptFor(attemptCount: number, now: number = Date.now()): string | null {
  if (attemptCount >= BACKOFF_STEPS_MINUTES.length) return null;
  const stepMinutes = BACKOFF_STEPS_MINUTES[attemptCount];
  return new Date(now + stepMinutes * 60_000).toISOString();
}

/**
 * Enqueue a failed revoke. Called by the share-revoke-url handler when the
 * initial sync attempt at Vercel DELETE fails. `firstError` is the message
 * from that failure. Schedules the first retry BACKOFF_STEPS_MINUTES[0]
 * minutes from now.
 */
export function enqueueRevoke(params: {
  shareId: string;
  vercelDeploymentId: string;
  vercelTeamId?: string;
  firstError: string;
  now?: number;
}): RevokeQueueEntry {
  const now = params.now ?? Date.now();
  const entry: RevokeQueueEntry = {
    shareId: params.shareId,
    vercelDeploymentId: params.vercelDeploymentId,
    vercelTeamId: params.vercelTeamId,
    firstAttemptAt: new Date(now).toISOString(),
    nextAttemptAt: nextAttemptFor(0, now) ?? new Date(now).toISOString(),
    attemptCount: 0,
    lastError: params.firstError,
  };
  const entries = readAll();
  const idx = entries.findIndex((e) => e.shareId === entry.shareId);
  if (idx >= 0) entries[idx] = entry;
  else entries.push(entry);
  writeAll(entries);
  return entry;
}

export function listPendingRevokes(): RevokeQueueEntry[] {
  return readAll();
}

export function removeFromQueue(shareId: string): boolean {
  const entries = readAll();
  const next = entries.filter((e) => e.shareId !== shareId);
  if (next.length === entries.length) return false;
  writeAll(next);
  return true;
}

/**
 * Record the outcome of an attempted retry. `success === true` removes the
 * entry. `success === false` bumps attemptCount + nextAttemptAt + lastError,
 * or marks gaveUp when we've exhausted the schedule.
 */
export function recordAttempt(
  shareId: string,
  outcome: { success: true } | { success: false; error: string },
  now: number = Date.now(),
): RevokeQueueEntry | null {
  const entries = readAll();
  const idx = entries.findIndex((e) => e.shareId === shareId);
  if (idx < 0) return null;
  const current = entries[idx];

  if (outcome.success) {
    entries.splice(idx, 1);
    writeAll(entries);
    return null;
  }

  const nextCount = current.attemptCount + 1;
  const nextAt = nextAttemptFor(nextCount, now);
  const updated: RevokeQueueEntry = {
    ...current,
    attemptCount: nextCount,
    lastError: outcome.error,
    nextAttemptAt: nextAt ?? current.nextAttemptAt,
    ...(nextAt === null ? { gaveUpAt: new Date(now).toISOString() } : {}),
  };
  entries[idx] = updated;
  writeAll(entries);
  return updated;
}

/**
 * Find entries whose nextAttemptAt is in the past AND which haven't given
 * up yet. Sorted oldest-due first so the worker processes the most-overdue
 * entry first.
 */
export function dueEntries(now: number = Date.now()): RevokeQueueEntry[] {
  const cutoff = new Date(now).toISOString();
  return readAll()
    .filter((e) => !e.gaveUpAt && e.nextAttemptAt <= cutoff)
    .sort((a, b) => (a.nextAttemptAt < b.nextAttemptAt ? -1 : 1));
}

/** ISO timestamp of the soonest pending retry, or null if none. Used by
 *  the worker to schedule its next wakeup. */
export function nextWakeupAt(now: number = Date.now()): string | null {
  const _ = now; // parameter reserved for future filtering (e.g. jitter)
  const pending = readAll().filter((e) => !e.gaveUpAt);
  if (pending.length === 0) return null;
  pending.sort((a, b) => (a.nextAttemptAt < b.nextAttemptAt ? -1 : 1));
  return pending[0].nextAttemptAt;
}

// Exported for tests so they don't need to guess the file path.
export { queuePath as revokeQueuePath };
