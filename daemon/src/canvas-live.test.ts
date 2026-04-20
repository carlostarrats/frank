import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-canvas-live-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { buildCanvasLivePayload } from './canvas-live.js';

function mkProject(id: string): string {
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCanvasState(projectId: string, konvaJson: object): void {
  fs.writeFileSync(
    path.join(PROJECTS_DIR, projectId, 'canvas-state.json'),
    JSON.stringify(konvaJson),
    'utf8',
  );
}

function writeAsset(projectId: string, filename: string, bytes: Buffer): string {
  const dir = path.join(PROJECTS_DIR, projectId, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `/files/projects/${projectId}/assets/${filename}`;
}

describe('canvas-live', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns null when no canvas-state.json exists', async () => {
    mkProject('p1');
    expect(await buildCanvasLivePayload('p1')).toBeNull();
  });

  it('returns empty assets map for a canvas with no images', async () => {
    mkProject('p1');
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{ className: 'Rect', attrs: { x: 0, y: 0, width: 10, height: 10 } }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.assets).toEqual({});
    expect(typeof payload!.canvasState).toBe('string');
  });

  it('inlines referenced assets as data URLs', async () => {
    mkProject('p1');
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const url = writeAsset('p1', 'abc123.png', pngBytes);
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{ className: 'Image', attrs: { assetUrl: url } }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload!.assets[url]).toBeDefined();
    expect(payload!.assets[url]).toMatch(/^data:image\/png;base64,/);
  });

  it('skips missing asset files without throwing', async () => {
    mkProject('p1');
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{ className: 'Image', attrs: { assetUrl: '/files/projects/p1/assets/missing.png' } }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload!.assets).toEqual({});
  });

  it('resolves assets referenced by nested groups', async () => {
    mkProject('p1');
    const url = writeAsset('p1', 'deep.png', Buffer.from([137, 80, 78, 71]));
    writeCanvasState('p1', {
      className: 'Layer',
      children: [{
        className: 'Group',
        children: [{ className: 'Image', attrs: { assetUrl: url } }],
      }],
    });
    const payload = await buildCanvasLivePayload('p1');
    expect(payload!.assets[url]).toBeDefined();
  });
});
