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

  it('canvas payload flows through decide-send to the fake cloud as a state event', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    // Seed a canvas-state.json so buildCanvasLivePayload has something to read.
    fs.writeFileSync(
      path.join(tmp, 'p1', 'canvas-state.json'),
      JSON.stringify({ className: 'Layer', children: [{ className: 'Rect', attrs: { x: 1, y: 2 } }] }),
      'utf8',
    );

    const { buildCanvasLivePayload } = await import('./canvas-live.js');
    const { decideCanvasSend, __resetForTests } = await import('./canvas-send-state.js');
    __resetForTests();

    const payload = await buildCanvasLivePayload('p1');
    expect(payload).not.toBeNull();

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-canvas',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    const decision = decideCanvasSend('share-canvas', payload!);
    expect(decision.kind).toBe('state'); // first push is always state
    ctl.pushState(decision.payload);
    await new Promise((r) => setTimeout(r, 250));

    const posts = fake.getPosts().filter((p) => p.shareId === 'share-canvas');
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('state');
    const body = posts[0].payload as { canvasState: string; assets: Record<string, string> };
    expect(body.canvasState).toContain('"Rect"');
    expect(body.assets).toEqual({}); // no images in this canvas
    await ctl.stop();
  });

  it('image payload flows through decide-send to the fake cloud as a state event', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    // Seed a project.json + source file + comments.json for p1.
    fs.writeFileSync(
      path.join(tmp, 'p1', 'project.json'),
      JSON.stringify({
        frank_version: '2',
        name: 'test',
        contentType: 'image',
        file: 'projects/p1/source/pic.png',
        screens: {},
        screenOrder: [],
        capture: false,
        activeShare: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.mkdirSync(path.join(tmp, 'p1', 'source'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'p1', 'source', 'pic.png'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    fs.writeFileSync(path.join(tmp, 'p1', 'comments.json'), JSON.stringify([]), 'utf8');

    const { buildImageLivePayload } = await import('./image-live.js');
    const { decideImageSend, __resetForTests } = await import('./image-send-state.js');
    __resetForTests();

    const payload = await buildImageLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.mimeType).toBe('image/png');

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-image',
      contentType: 'image',
      ratePerSecond: 30,
    });
    const decision = decideImageSend('share-image', payload!);
    expect(decision.kind).toBe('state');
    ctl.pushState(decision.payload);
    await new Promise((r) => setTimeout(r, 250));

    const posts = fake.getPosts().filter((p) => p.shareId === 'share-image');
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('state');
    const body = posts[0].payload as { fileDataUrl: string; mimeType: string; comments: unknown[] };
    expect(body.fileDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(body.mimeType).toBe('image/png');
    expect(body.comments).toEqual([]);
    await ctl.stop();
  });

  it('PDF payload flows through decide-send to the fake cloud as a state event', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    // Seed a project.json + source file + comments.json for p1.
    fs.writeFileSync(
      path.join(tmp, 'p1', 'project.json'),
      JSON.stringify({
        frank_version: '2',
        name: 'test',
        contentType: 'pdf',
        file: 'projects/p1/source/doc.pdf',
        screens: {},
        screenOrder: [],
        capture: false,
        activeShare: null,
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      }),
      'utf8',
    );
    fs.mkdirSync(path.join(tmp, 'p1', 'source'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'p1', 'source', 'doc.pdf'),
      Buffer.from('%PDF-1.4\n'),
    );
    fs.writeFileSync(path.join(tmp, 'p1', 'comments.json'), JSON.stringify([]), 'utf8');

    const { buildPdfLivePayload } = await import('./pdf-live.js');
    const { decidePdfSend, __resetForTests } = await import('./pdf-send-state.js');
    __resetForTests();

    const payload = await buildPdfLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.mimeType).toBe('application/pdf');

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-pdf',
      contentType: 'pdf',
      ratePerSecond: 30,
    });
    const decision = decidePdfSend('share-pdf', payload!);
    expect(decision.kind).toBe('state');
    ctl.pushState(decision.payload);
    await new Promise((r) => setTimeout(r, 250));

    const posts = fake.getPosts().filter((p) => p.shareId === 'share-pdf');
    expect(posts.length).toBe(1);
    expect(posts[0].type).toBe('state');
    const body = posts[0].payload as { fileDataUrl: string; mimeType: string; comments: unknown[] };
    expect(body.fileDataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(body.mimeType).toBe('application/pdf');
    expect(body.comments).toEqual([]);
    await ctl.stop();
  });

  it('pushState after resume delivers to backend (not dropped by paused state)', async () => {
    clearV2OnlyMarker();
    const liveFile = path.join(tmp, 'p1', 'live.json');
    if (fs.existsSync(liveFile)) fs.unlinkSync(liveFile);

    const ctl = new LiveShareController({
      projectId: 'p1',
      shareId: 'share-resume',
      contentType: 'canvas',
      ratePerSecond: 30,
    });
    ctl.pause();
    ctl.pushState({ step: 'during-pause' });
    await new Promise((r) => setTimeout(r, 200));
    const beforeResume = fake.getPosts().filter((p) => p.shareId === 'share-resume').length;
    expect(beforeResume).toBe(0); // paused drops the push

    ctl.resume();
    ctl.pushState({ step: 'after-resume' });
    await new Promise((r) => setTimeout(r, 250));
    const afterResume = fake.getPosts().filter((p) => p.shareId === 'share-resume');
    expect(afterResume.length).toBe(1);
    expect(afterResume[0].payload).toEqual({ step: 'after-resume' });
    await ctl.stop();
  });
});
