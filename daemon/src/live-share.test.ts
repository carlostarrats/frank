import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  return { ...mod, PROJECTS_DIR: '/tmp/frank-ls-test' };
});

vi.mock('./cloud.js', () => ({
  postState: vi.fn().mockResolvedValue({ acceptedRevision: 0 }),
  openAuthorStream: vi.fn().mockReturnValue({ close: () => {}, on: () => {} }),
  revokeShare: vi.fn().mockResolvedValue({ ok: true }),
  isBackendV2Only: vi.fn().mockReturnValue(false),
  markBackendV2Only: vi.fn(),
  clearV2OnlyMarker: vi.fn(),
}));

import { LiveShareController } from './live-share.js';
import * as cloud from './cloud.js';
import fs from 'fs';
import path from 'path';

beforeEach(() => {
  fs.rmSync('/tmp/frank-ls-test', { recursive: true, force: true });
  fs.mkdirSync('/tmp/frank-ls-test/p1', { recursive: true });
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('LiveShareController', () => {
  it('coalesces bursts of state pushes into a single send', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 10,
    });
    for (let i = 0; i < 20; i++) ctl.pushState({ shapes: i });
    await vi.advanceTimersByTimeAsync(120);
    expect(cloud.postState).toHaveBeenCalledTimes(1);
    const lastCall = (cloud.postState as any).mock.calls[0][1];
    expect(lastCall.payload).toEqual({ shapes: 19 });
    expect(lastCall.type).toBe('state');
    await ctl.stop();
  });

  it('enforces per-second rate cap across sustained traffic', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 5,
    });
    for (let i = 0; i < 60; i++) {
      ctl.pushState({ shapes: i });
      await vi.advanceTimersByTimeAsync(20);
    }
    await vi.advanceTimersByTimeAsync(500);
    // 60 input bursts over 1.2s with cap=5/s: we should see at most ~6 sends.
    expect((cloud.postState as any).mock.calls.length).toBeLessThanOrEqual(7);
    await ctl.stop();
  });

  it('fast-forwards revision on revision-behind response', async () => {
    let calls = 0;
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => {
      calls++;
      if (calls === 1) return { error: 'revision-behind', currentRevision: 500 };
      return { acceptedRevision: body.revision };
    });
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    ctl.pushState({ shapes: 1 });
    await vi.advanceTimersByTimeAsync(150);
    ctl.pushState({ shapes: 2 });
    await vi.advanceTimersByTimeAsync(150);
    const secondCall = (cloud.postState as any).mock.calls[1][1];
    expect(secondCall.revision).toBeGreaterThan(500);
    await ctl.stop();
  });

  it('auto-pauses after 2 hours of continuous live sharing', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let timedOut = false;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onSessionTimeout: () => { timedOut = true; },
    });
    // Just under 2h — should still be live.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 - 1_000);
    expect(timedOut).toBe(false);
    // Cross the 2h mark.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(timedOut).toBe(true);
    // Pushes after auto-pause are silently dropped — no more calls.
    const callsBefore = (cloud.postState as any).mock.calls.length;
    ctl.pushState({ late: true });
    await vi.advanceTimersByTimeAsync(500);
    expect((cloud.postState as any).mock.calls.length).toBe(callsBefore);
    await ctl.stop();
  });

  it('resume restarts the 2-hour clock', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let timeoutCount = 0;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onSessionTimeout: () => { timeoutCount++; },
    });
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 100);
    expect(timeoutCount).toBe(1);
    ctl.resume();
    // An hour in — should NOT have fired again.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(timeoutCount).toBe(1);
    // Another hour — should fire a second time.
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    expect(timeoutCount).toBe(2);
    await ctl.stop();
  });
});
