import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tmp: string;

vi.mock('../protocol.js', () => {
  const original = vi.importActual('../protocol.js') as any;
  return {
    ...original,
    get FRANK_DIR() { return tmp; },
  };
});

import {
  enqueueRevoke,
  listPendingRevokes,
  removeFromQueue,
  recordAttempt,
  dueEntries,
  nextWakeupAt,
  nextAttemptFor,
  BACKOFF_STEPS_MINUTES,
  revokeQueuePath,
} from './revoke-queue.js';

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-revoke-queue-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('revoke-queue — nextAttemptFor', () => {
  it('returns correct timestamps for each step in the schedule', () => {
    const base = new Date('2026-04-23T10:00:00.000Z').getTime();
    expect(nextAttemptFor(0, base)).toBe('2026-04-23T10:01:00.000Z');   // +1min
    expect(nextAttemptFor(1, base)).toBe('2026-04-23T10:05:00.000Z');   // +5min
    expect(nextAttemptFor(2, base)).toBe('2026-04-23T10:30:00.000Z');   // +30min
    expect(nextAttemptFor(3, base)).toBe('2026-04-23T11:00:00.000Z');   // +60min
    expect(nextAttemptFor(4, base)).toBe('2026-04-23T16:00:00.000Z');   // +6h
    expect(nextAttemptFor(5, base)).toBe('2026-04-24T10:00:00.000Z');   // +24h
  });

  it('returns null once the schedule is exhausted', () => {
    const base = Date.now();
    expect(nextAttemptFor(BACKOFF_STEPS_MINUTES.length, base)).toBeNull();
    expect(nextAttemptFor(BACKOFF_STEPS_MINUTES.length + 5, base)).toBeNull();
  });
});

describe('revoke-queue — enqueueRevoke + listPendingRevokes', () => {
  it('adds a new entry with attemptCount=0 + first backoff window', () => {
    const base = new Date('2026-04-23T10:00:00.000Z').getTime();
    enqueueRevoke({
      shareId: 's1',
      vercelDeploymentId: 'dpl_1',
      firstError: 'Vercel API 500',
      now: base,
    });
    const list = listPendingRevokes();
    expect(list).toHaveLength(1);
    expect(list[0].shareId).toBe('s1');
    expect(list[0].attemptCount).toBe(0);
    expect(list[0].firstAttemptAt).toBe('2026-04-23T10:00:00.000Z');
    expect(list[0].nextAttemptAt).toBe('2026-04-23T10:01:00.000Z');
    expect(list[0].lastError).toBe('Vercel API 500');
    expect(list[0].gaveUpAt).toBeUndefined();
  });

  it('file is created with mode 0600', () => {
    enqueueRevoke({ shareId: 'x', vercelDeploymentId: 'd', firstError: 'e' });
    const target = revokeQueuePath();
    expect(fs.existsSync(target)).toBe(true);
    expect((fs.statSync(target).mode & 0o777).toString(8)).toBe('600');
  });

  it('enqueueing the same shareId twice replaces the first entry', () => {
    enqueueRevoke({ shareId: 'same', vercelDeploymentId: 'd1', firstError: 'a' });
    enqueueRevoke({ shareId: 'same', vercelDeploymentId: 'd2', firstError: 'b' });
    const list = listPendingRevokes();
    expect(list).toHaveLength(1);
    expect(list[0].vercelDeploymentId).toBe('d2');
    expect(list[0].lastError).toBe('b');
  });

  it('listPendingRevokes is empty when no file exists', () => {
    expect(listPendingRevokes()).toEqual([]);
  });

  it('carries teamId through when provided', () => {
    enqueueRevoke({
      shareId: 's',
      vercelDeploymentId: 'd',
      vercelTeamId: 'team_xyz',
      firstError: 'e',
    });
    expect(listPendingRevokes()[0].vercelTeamId).toBe('team_xyz');
  });
});

describe('revoke-queue — recordAttempt', () => {
  it('removes the entry on success', () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'd', firstError: 'e' });
    const r = recordAttempt('s', { success: true });
    expect(r).toBeNull();
    expect(listPendingRevokes()).toEqual([]);
  });

  it('bumps attemptCount + reschedules on failure', () => {
    const base = new Date('2026-04-23T10:00:00.000Z').getTime();
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'd', firstError: 'first', now: base });
    const r = recordAttempt('s', { success: false, error: 'retry failed too' }, base);
    expect(r).not.toBeNull();
    expect(r!.attemptCount).toBe(1);
    expect(r!.lastError).toBe('retry failed too');
    expect(r!.nextAttemptAt).toBe('2026-04-23T10:05:00.000Z'); // +5min (step 1)
    expect(r!.gaveUpAt).toBeUndefined();
  });

  it('marks gaveUpAt after the final step fails', () => {
    const base = Date.now();
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'd', firstError: 'e' });
    // Burn through all BACKOFF_STEPS retries.
    for (let i = 0; i < BACKOFF_STEPS_MINUTES.length - 1; i++) {
      const r = recordAttempt('s', { success: false, error: 'still broken' }, base);
      expect(r!.gaveUpAt).toBeUndefined();
    }
    // One more failure after the last step → give up.
    const final = recordAttempt('s', { success: false, error: 'Vercel down for a day' }, base);
    expect(final!.gaveUpAt).toBeTruthy();
    expect(final!.attemptCount).toBe(BACKOFF_STEPS_MINUTES.length);
    // Gave-up entries stay on disk for UI surfacing.
    expect(listPendingRevokes()).toHaveLength(1);
  });

  it('no-ops on unknown shareId', () => {
    expect(recordAttempt('ghost', { success: true })).toBeNull();
    expect(recordAttempt('ghost', { success: false, error: 'x' })).toBeNull();
  });
});

describe('revoke-queue — dueEntries', () => {
  it('returns only entries whose nextAttemptAt is in the past', () => {
    const base = new Date('2026-04-23T10:00:00.000Z').getTime();
    enqueueRevoke({ shareId: 's-old', vercelDeploymentId: 'd1', firstError: 'e', now: base });
    enqueueRevoke({ shareId: 's-new', vercelDeploymentId: 'd2', firstError: 'e', now: base + 30 * 60_000 });
    // At base + 2min: s-old is due (next was +1min), s-new is not (next was base+30+1 = 31min).
    const due = dueEntries(base + 2 * 60_000);
    expect(due.map((e) => e.shareId)).toEqual(['s-old']);
  });

  it('excludes entries that have given up', () => {
    const base = Date.now();
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'd', firstError: 'e' });
    for (let i = 0; i < BACKOFF_STEPS_MINUTES.length; i++) {
      recordAttempt('s', { success: false, error: 'x' }, base);
    }
    // At any time far in the future, the gave-up entry is not due.
    const far = base + 10 * 86400000;
    expect(dueEntries(far)).toEqual([]);
  });

  it('sorts oldest-due first', () => {
    const base = new Date('2026-04-23T10:00:00.000Z').getTime();
    enqueueRevoke({ shareId: 's-b', vercelDeploymentId: 'd', firstError: 'e', now: base + 5 * 60_000 });
    enqueueRevoke({ shareId: 's-a', vercelDeploymentId: 'd', firstError: 'e', now: base });
    // Both due at base + 10min.
    const due = dueEntries(base + 10 * 60_000);
    // s-a's next was base+1min; s-b's was base+6min. Oldest-due first.
    expect(due.map((e) => e.shareId)).toEqual(['s-a', 's-b']);
  });
});

describe('revoke-queue — nextWakeupAt', () => {
  it('returns null when queue is empty', () => {
    expect(nextWakeupAt()).toBeNull();
  });

  it('returns the soonest nextAttemptAt across pending entries', () => {
    const base = new Date('2026-04-23T10:00:00.000Z').getTime();
    enqueueRevoke({ shareId: 's1', vercelDeploymentId: 'd', firstError: 'e', now: base + 10 * 60_000 });
    enqueueRevoke({ shareId: 's2', vercelDeploymentId: 'd', firstError: 'e', now: base });
    const soon = nextWakeupAt();
    // s2's next was base+1min, s1's was base+11min. Soonest is s2's.
    expect(soon).toBe('2026-04-23T10:01:00.000Z');
  });

  it('skips gave-up entries', () => {
    const base = Date.now();
    enqueueRevoke({ shareId: 's1', vercelDeploymentId: 'd', firstError: 'e' });
    for (let i = 0; i < BACKOFF_STEPS_MINUTES.length; i++) {
      recordAttempt('s1', { success: false, error: 'x' }, base);
    }
    // Only s1 exists and it gave up → null.
    expect(nextWakeupAt()).toBeNull();
  });
});

describe('revoke-queue — removeFromQueue', () => {
  it('drops the matching entry and returns true', () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'd', firstError: 'e' });
    expect(removeFromQueue('s')).toBe(true);
    expect(listPendingRevokes()).toEqual([]);
  });

  it('returns false on unknown shareId', () => {
    expect(removeFromQueue('ghost')).toBe(false);
  });
});
