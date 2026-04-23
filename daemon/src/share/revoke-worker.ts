// Background worker that drains revoke-queue.json. Completes Item 6.
//
// Model: single long-lived daemon-wide worker. Sleeps with setTimeout until
// the soonest nextAttemptAt, then processes every currently-due entry,
// reschedules, and sleeps again. Re-armed by notifyRevokeEnqueued() when a
// new entry arrives (otherwise a fresh enqueue would wait until the next
// already-scheduled wake).
//
// Inputs are injected (Vercel token getter + delete function) so tests can
// drive the worker without touching real Vercel or the on-disk config.

import {
  dueEntries,
  nextWakeupAt,
  recordAttempt,
  type RevokeQueueEntry,
} from './revoke-queue.js';

export interface RevokeWorkerDeps {
  /** Read the current Vercel token. Returning null skips attempts (records
   *  the attempt as failed with an explicit "no token" message) — user may
   *  have cleared the token after enqueueing. */
  getVercelToken: () => { token: string; teamId?: string } | null;
  /** Vercel DELETE caller, typically vercel-api.ts#deleteDeployment. */
  deleteDeployment: (args: {
    token: string;
    deploymentId: string;
    teamId?: string;
  }) => Promise<void>;
  /** Fires on a successful retry, for record-patching + telemetry. */
  onSuccess?: (entry: RevokeQueueEntry) => void;
  /** Fires on a failed retry. `gaveUp` is true when the schedule is exhausted. */
  onFailure?: (entry: RevokeQueueEntry, error: string, gaveUp: boolean) => void;
}

let pendingTimeout: ReturnType<typeof setTimeout> | null = null;
let currentDeps: RevokeWorkerDeps | null = null;
let running = false;
let testClockOverride: (() => number) | null = null;

/**
 * Start the worker. Safe to call multiple times — a second call re-arms
 * the timer with potentially-updated deps. Intended to be called once on
 * daemon startup.
 */
export function startRevokeWorker(deps: RevokeWorkerDeps): void {
  currentDeps = deps;
  running = true;
  scheduleNext();
}

/** Stop the worker and clear any pending wakeup. Used by tests. */
export function stopRevokeWorker(): void {
  running = false;
  if (pendingTimeout) {
    clearTimeout(pendingTimeout);
    pendingTimeout = null;
  }
}

/**
 * Signal that a new entry was enqueued. Re-arms the timer so the worker
 * wakes at the new soonest nextAttemptAt instead of waiting for the
 * previously-scheduled wake.
 */
export function notifyRevokeEnqueued(): void {
  scheduleNext();
}

/** Test-only: override Date.now() so we can drive the scheduler deterministically. */
export function __setWorkerClockForTests(fn: (() => number) | null): void {
  testClockOverride = fn;
}

function now(): number {
  return testClockOverride ? testClockOverride() : Date.now();
}

function scheduleNext(): void {
  if (!running) return;
  if (pendingTimeout) { clearTimeout(pendingTimeout); pendingTimeout = null; }
  const nextAt = nextWakeupAt(now());
  if (!nextAt) return;
  // Floor at 0, cap at 24h. setTimeout with huge values is supported but
  // rescheduling after daemon wake-from-sleep is more predictable with a cap.
  const delay = Math.min(24 * 60 * 60_000, Math.max(0, new Date(nextAt).getTime() - now()));
  pendingTimeout = setTimeout(() => { pendingTimeout = null; processDue(); }, delay);
  // Keep Node's event loop alive only if there's real pending work. Nothing
  // to do here explicitly: setTimeout without `.unref()` already keeps the
  // process alive until it fires, which matches what we want.
}

async function processDue(): Promise<void> {
  if (!running || !currentDeps) return;
  const deps = currentDeps;
  const due = dueEntries(now());
  for (const entry of due) {
    await attempt(entry, deps);
  }
  scheduleNext();
}

async function attempt(entry: RevokeQueueEntry, deps: RevokeWorkerDeps): Promise<void> {
  const creds = deps.getVercelToken();
  if (!creds) {
    const updated = recordAttempt(entry.shareId, {
      success: false,
      error: 'No Vercel token configured; cannot retry delete.',
    }, now());
    if (updated) deps.onFailure?.(updated, updated.lastError ?? 'no token', !!updated.gaveUpAt);
    return;
  }
  try {
    await deps.deleteDeployment({
      token: creds.token,
      deploymentId: entry.vercelDeploymentId,
      teamId: entry.vercelTeamId ?? creds.teamId,
    });
    recordAttempt(entry.shareId, { success: true }, now());
    deps.onSuccess?.(entry);
  } catch (err: any) {
    const msg = err?.message || String(err);
    const updated = recordAttempt(entry.shareId, { success: false, error: msg }, now());
    if (updated) deps.onFailure?.(updated, msg, !!updated.gaveUpAt);
  }
}

// Test-only helper: drain the queue synchronously for assertions.
export async function __processDueForTests(): Promise<void> {
  await processDue();
}
