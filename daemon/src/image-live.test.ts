import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-image-live-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { buildImageLivePayload } from './image-live.js';

function mkProject(id: string, projectJson: object): void {
  const dir = path.join(PROJECTS_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(projectJson), 'utf8');
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify([]), 'utf8');
}

function writeSourceFile(projectId: string, filename: string, bytes: Buffer): string {
  const dir = path.join(PROJECTS_DIR, projectId, 'source');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), bytes);
  return `projects/${projectId}/source/${filename}`;
}

function writeComments(projectId: string, comments: unknown[]): void {
  fs.writeFileSync(
    path.join(PROJECTS_DIR, projectId, 'comments.json'),
    JSON.stringify(comments),
    'utf8',
  );
}

describe('image-live', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns null when the project has no source file', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    expect(await buildImageLivePayload('p1')).toBeNull();
  });

  it('returns null when the source file is missing from disk', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      file: 'projects/p1/source/missing.png',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    expect(await buildImageLivePayload('p1')).toBeNull();
  });

  it('returns payload with inlined image + comments', async () => {
    const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const filePath = writeSourceFile('p1', 'pic.png', pngBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    writeComments('p1', [
      { id: 'c1', screenId: 'default', anchor: { type: 'pin', x: 10, y: 20 }, author: 'You', text: 'hi', ts: '2026-01-01T00:00:00Z', status: 'pending' },
    ]);

    const payload = await buildImageLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.fileDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(payload!.mimeType).toBe('image/png');
    expect(payload!.comments).toHaveLength(1);
    expect(payload!.comments[0].text).toBe('hi');
  });

  it('derives MIME from file extension (.jpg → image/jpeg)', async () => {
    const jpgBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    const filePath = writeSourceFile('p1', 'pic.jpg', jpgBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'image',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    const payload = await buildImageLivePayload('p1');
    expect(payload!.mimeType).toBe('image/jpeg');
    expect(payload!.fileDataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });
});
