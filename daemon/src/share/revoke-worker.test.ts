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
  startRevokeWorker,
  stopRevokeWorker,
  __setWorkerClockForTests,
  __processDueForTests,
} from './revoke-worker.js';
import {
  enqueueRevoke,
  listPendingRevokes,
  BACKOFF_STEPS_MINUTES,
} from './revoke-queue.js';

let clock: number;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-revoke-worker-'));
  clock = new Date('2026-04-23T10:00:00.000Z').getTime();
  __setWorkerClockForTests(() => clock);
});
afterEach(() => {
  __setWorkerClockForTests(null);
  stopRevokeWorker();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function advance(ms: number) { clock += ms; }

describe('revoke-worker — happy path', () => {
  it('calls deleteDeployment and removes the entry on success', async () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'dpl', firstError: 'initial fail', now: clock });
    const calls: Array<{ token: string; deploymentId: string }> = [];
    startRevokeWorker({
      getVercelToken: () => ({ token: 'T', teamId: undefined }),
      deleteDeployment: async (args) => { calls.push({ token: args.token, deploymentId: args.deploymentId }); },
    });
    // Advance past the first backoff window.
    advance((BACKOFF_STEPS_MINUTES[0] + 1) * 60_000);
    await __processDueForTests();
    expect(calls).toEqual([{ token: 'T', deploymentId: 'dpl' }]);
    expect(listPendingRevokes()).toEqual([]);
  });

  it('fires onSuccess when retry succeeds', async () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'dpl', firstError: 'x', now: clock });
    const successes: string[] = [];
    startRevokeWorker({
      getVercelToken: () => ({ token: 'T' }),
      deleteDeployment: async () => {},
      onSuccess: (entry) => successes.push(entry.shareId),
    });
    advance(2 * 60_000);
    await __processDueForTests();
    expect(successes).toEqual(['s']);
  });
});

describe('revoke-worker — failure path', () => {
  it('bumps attemptCount + reschedules when Vercel delete throws', async () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'dpl', firstError: 'initial', now: clock });
    const failures: Array<{ id: string; error: string; gaveUp: boolean }> = [];
    startRevokeWorker({
      getVercelToken: () => ({ token: 'T' }),
      deleteDeployment: async () => { throw new Error('Vercel 503'); },
      onFailure: (entry, error, gaveUp) => failures.push({ id: entry.shareId, error, gaveUp }),
    });
    advance(2 * 60_000);
    await __processDueForTests();

    const entries = listPendingRevokes();
    expect(entries).toHaveLength(1);
    expect(entries[0].attemptCount).toBe(1);
    expect(entries[0].lastError).toBe('Vercel 503');
    expect(entries[0].gaveUpAt).toBeUndefined();
    expect(failures).toEqual([{ id: 's', error: 'Vercel 503', gaveUp: false }]);
  });

  it('records no-token as a failure rather than silently skipping', async () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'dpl', firstError: 'x', now: clock });
    const failures: string[] = [];
    startRevokeWorker({
      getVercelToken: () => null,
      deleteDeployment: async () => { throw new Error('shouldn\'t be called'); },
      onFailure: (entry) => failures.push(entry.shareId),
    });
    advance(2 * 60_000);
    await __processDueForTests();
    const entries = listPendingRevokes();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastError).toContain('No Vercel token');
    expect(failures).toEqual(['s']);
  });

  it('marks the entry gave-up after the full schedule fails + stops retrying', async () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'dpl', firstError: 'initial', now: clock });
    const failures: Array<{ gaveUp: boolean }> = [];
    startRevokeWorker({
      getVercelToken: () => ({ token: 'T' }),
      deleteDeployment: async () => { throw new Error('Vercel down'); },
      onFailure: (_entry, _error, gaveUp) => failures.push({ gaveUp }),
    });
    // Burn through every step.
    for (let i = 0; i < BACKOFF_STEPS_MINUTES.length; i++) {
      advance((BACKOFF_STEPS_MINUTES[i] + 1) * 60_000);
      await __processDueForTests();
    }
    const entries = listPendingRevokes();
    expect(entries).toHaveLength(1);
    expect(entries[0].gaveUpAt).toBeTruthy();
    expect(entries[0].attemptCount).toBe(BACKOFF_STEPS_MINUTES.length);
    // Worker should have fired onFailure once per step, last with gaveUp=true.
    expect(failures).toHaveLength(BACKOFF_STEPS_MINUTES.length);
    expect(failures[failures.length - 1].gaveUp).toBe(true);
    // Further passes don't retry a gave-up entry.
    advance(100 * 86400000);
    const before = fs.readFileSync(path.join(tmp, 'revoke-queue.json'), 'utf-8');
    await __processDueForTests();
    const after = fs.readFileSync(path.join(tmp, 'revoke-queue.json'), 'utf-8');
    expect(after).toBe(before);
  });
});

describe('revoke-worker — scheduling', () => {
  it('processes multiple due entries in one pass', async () => {
    enqueueRevoke({ shareId: 's1', vercelDeploymentId: 'd1', firstError: 'e', now: clock });
    enqueueRevoke({ shareId: 's2', vercelDeploymentId: 'd2', firstError: 'e', now: clock });
    const deleted: string[] = [];
    startRevokeWorker({
      getVercelToken: () => ({ token: 'T' }),
      deleteDeployment: async (args) => { deleted.push(args.deploymentId); },
    });
    advance(2 * 60_000);
    await __processDueForTests();
    expect(deleted.sort()).toEqual(['d1', 'd2']);
    expect(listPendingRevokes()).toEqual([]);
  });

  it('skips entries that are not yet due', async () => {
    enqueueRevoke({ shareId: 's', vercelDeploymentId: 'd', firstError: 'e', now: clock });
    const calls: string[] = [];
    startRevokeWorker({
      getVercelToken: () => ({ token: 'T' }),
      deleteDeployment: async (args) => { calls.push(args.deploymentId); },
    });
    // Only advance 10 seconds — much less than the first step (1 min).
    advance(10_000);
    await __processDueForTests();
    expect(calls).toEqual([]);
    expect(listPendingRevokes()).toHaveLength(1);
  });
});
