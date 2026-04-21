import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-ls-'));
  return { ...mod, PROJECTS_DIR: tmp };
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
import { PROJECTS_DIR } from './protocol.js';

beforeEach(() => {
  for (const d of fs.readdirSync(PROJECTS_DIR)) {
    fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
  }
  fs.mkdirSync(path.join(PROJECTS_DIR, 'p1'), { recursive: true });
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

  // Burst cap isolation: sustained cap is raised to effectively infinite so
  // burst is the only binding constraint. 100 KB payloads × ~32 rapid pushes
  // total ~3.2 MB, which exceeds the 3 MB burst cap sometime around push 31.
  it('burst cap throttles when ~3 MB accumulates within the 10s burst window', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let throttleStarts = 0;
    let throttleClears = 0;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      burstCapBytes: 3 * 1024 * 1024,
      sustainedCapBytes: 100 * 1024 * 1024, // unlimited-for-test
      onBandwidthStatus: (throttled) => {
        if (throttled) throttleStarts++; else throttleClears++;
      },
    });
    const payload = { blob: 'x'.repeat(100_000) };
    for (let i = 0; i < 40; i++) {
      ctl.pushState({ ...payload, i });
      await vi.advanceTimersByTimeAsync(120);
    }
    // Burst cap should fire exactly once before the window slides.
    expect(throttleStarts).toBe(1);
    // Roughly 28–32 successful pushes before throttle (exact count depends on
    // JSON serialization overhead). The remainder are coalesced into pending
    // and flushed after the window slides.
    const callsBeforeSlide = (cloud.postState as any).mock.calls.length;
    expect(callsBeforeSlide).toBeGreaterThanOrEqual(28);
    expect(callsBeforeSlide).toBeLessThanOrEqual(32);
    // Advance past the burst window — timer fires precisely, not on a poll.
    await vi.advanceTimersByTimeAsync(11_000);
    expect((cloud.postState as any).mock.calls.length).toBeGreaterThan(callsBeforeSlide);
    expect(throttleClears).toBe(1);
    await ctl.stop();
  });

  // Sustained cap isolation: burst cap is raised so sustained is the only
  // binding constraint. 400 KB payloads at 2-second pacing — burst window
  // slides between pushes so burst never fills, but cumulative usage in the
  // 60s sustained window crosses 1 MB on the 3rd push.
  it('sustained cap throttles when >1 MB accumulates within the 60s sustained window', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    let throttleStarts = 0;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      burstCapBytes: 100 * 1024 * 1024, // unlimited-for-test
      sustainedCapBytes: 1 * 1024 * 1024,
      onBandwidthStatus: (throttled) => { if (throttled) throttleStarts++; },
    });
    const payload = { blob: 'x'.repeat(400_000) };
    // Push 1 at t=0: 400 KB cumulative — under 1 MB. OK.
    ctl.pushState({ ...payload, i: 0 });
    await vi.advanceTimersByTimeAsync(2_000);
    // Push 2 at t=2s: 800 KB cumulative — under 1 MB. OK.
    ctl.pushState({ ...payload, i: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    // Push 3 at t=4s: would make 1.2 MB cumulative — over 1 MB. Throttles.
    ctl.pushState({ ...payload, i: 2 });
    await vi.advanceTimersByTimeAsync(200);
    expect(throttleStarts).toBe(1);
    expect((cloud.postState as any).mock.calls.length).toBe(2);
    await ctl.stop();
  });

  // Cancel behavior: uses burst isolation so throttle is exercised, then a
  // tiny edit arrives and should cancel the pending retry and flush immediately.
  it('new edit during throttle cancels the pending retry if it fits the remaining budget', async () => {
    (cloud.postState as any).mockImplementation(async (_s: string, body: any) => ({
      acceptedRevision: body.revision,
    }));
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      burstCapBytes: 3 * 1024 * 1024,
      sustainedCapBytes: 100 * 1024 * 1024,
    });
    const bigPayload = { blob: 'x'.repeat(1_000_000) };
    for (let i = 0; i < 3; i++) {
      ctl.pushState({ ...bigPayload, i });
      await vi.advanceTimersByTimeAsync(120);
    }
    // Fourth big push fills 4 MB > 3 MB cap → throttled with ~10s retry.
    ctl.pushState({ ...bigPayload, i: 3 });
    await vi.advanceTimersByTimeAsync(120);
    const callsAfterThrottle = (cloud.postState as any).mock.calls.length;
    // Tiny edit arrives. Pending is replaced; throttle timer cancels; fits now
    // because tiny byte count leaves burst budget intact.
    ctl.pushState({ shapes: 42 });
    await vi.advanceTimersByTimeAsync(120);
    expect((cloud.postState as any).mock.calls.length).toBeGreaterThan(callsAfterThrottle);
    const lastCall = (cloud.postState as any).mock.calls.at(-1)[1];
    expect(lastCall.payload).toEqual({ shapes: 42 });
    await ctl.stop();
  });

  it('413 response pauses the controller without retrying', async () => {
    let calls = 0;
    (cloud.postState as any).mockImplementation(async () => {
      calls++;
      return { error: 'payload-too-large', httpStatus: 413 };
    });
    let err = '';
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 's1',
      contentType: 'canvas',
      ratePerSecond: 30,
      onError: (e) => { err = e; },
    });
    ctl.pushState({ blob: 'x'.repeat(2_000_000) });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(err).toBe('payload-too-large');
    expect(calls).toBe(1);
    // Further pushes dropped until resume.
    ctl.pushState({ shapes: 1 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toBe(1);
    await ctl.stop();
  });
});
