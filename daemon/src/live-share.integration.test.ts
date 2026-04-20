import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const { tmp } = vi.hoisted(() => {
  const { mkdtempSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');
  return { tmp: mkdtempSync(join(tmpdir(), 'frank-int-')) as string };
});

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  return { ...mod, PROJECTS_DIR: tmp, CONFIG_PATH: path.join(tmp, 'config.json') };
});

import { startFakeCloud } from '../test/fake-cloud.js';
import { saveCloudConfig, clearV2OnlyMarker } from './cloud.js';
import { LiveShareController } from './live-share.js';

let fake: Awaited<ReturnType<typeof startFakeCloud>>;

beforeAll(async () => {
  fake = await startFakeCloud('test-key');
  fs.mkdirSync(path.join(tmp, 'p1'), { recursive: true });
  saveCloudConfig(fake.url, 'test-key');
  clearV2OnlyMarker();
});

afterAll(async () => { await fake.stop(); });

describe('live share — integration with fake cloud', () => {
  it('pushState reaches the backend with monotonic revisions', async () => {
    clearV2OnlyMarker();
    // Reset the project's revision file so the test starts from 0.
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share1',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    ctl.pushState({ step: 'a' });
    await new Promise((r) => setTimeout(r, 250));
    ctl.pushState({ step: 'b' });
    await new Promise((r) => setTimeout(r, 250));
    const postsForShare = fake.getPosts().filter((p) => p.shareId === 'share1');
    expect(postsForShare.length).toBe(2);
    expect(postsForShare[0].revision).toBe(1);
    expect(postsForShare[1].revision).toBe(2);
    expect(postsForShare[0].payload).toEqual({ step: 'a' });
    expect(postsForShare[1].payload).toEqual({ step: 'b' });
    await ctl.stop();
  });

  it('receives broadcast comments via author-stream', async () => {
    clearV2OnlyMarker();
    let received: unknown = null;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share2',
      contentType: 'canvas',
      ratePerSecond: 30,
      onComment: (c) => { received = c; },
    });
    // Allow the author-stream to connect + emit its initial ": hello" line.
    await new Promise((r) => setTimeout(r, 300));
    fake.broadcastComment('share2', { id: 'c1', text: 'hi' });
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toEqual({ id: 'c1', text: 'hi' });
    await ctl.stop();
  });

  it('surfaces share-ended when the backend broadcasts it', async () => {
    clearV2OnlyMarker();
    let ended: string | null = null;
    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share3',
      contentType: 'canvas',
      ratePerSecond: 30,
      onShareEnded: (reason) => { ended = reason; },
    });
    await new Promise((r) => setTimeout(r, 300));
    fake.broadcastShareEnded('share3', 'revoked');
    await new Promise((r) => setTimeout(r, 300));
    expect(ended).toBe('revoked');
    await ctl.stop();
  });
});
