import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-pdf-live-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { buildPdfLivePayload } from './pdf-live.js';

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

describe('pdf-live', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns null when the project has no source file', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    expect(await buildPdfLivePayload('p1')).toBeNull();
  });

  it('returns null when the source file is missing from disk', async () => {
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      file: 'projects/p1/source/missing.pdf',
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    expect(await buildPdfLivePayload('p1')).toBeNull();
  });

  it('returns payload with inlined PDF + comments', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n');
    const filePath = writeSourceFile('p1', 'doc.pdf', pdfBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    writeComments('p1', [
      { id: 'c1', screenId: 'default', anchor: { type: 'pin', x: 10, y: 20, pageNumber: 1 }, author: 'You', text: 'hi', ts: '2026-01-01T00:00:00Z', status: 'pending' },
    ]);

    const payload = await buildPdfLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.fileDataUrl).toMatch(/^data:application\/pdf;base64,/);
    expect(payload!.mimeType).toBe('application/pdf');
    expect(payload!.comments).toHaveLength(1);
    expect(payload!.comments[0].text).toBe('hi');
  });

  it('accepts uppercase .PDF extension', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\n');
    const filePath = writeSourceFile('p1', 'report.PDF', pdfBytes);
    mkProject('p1', {
      frank_version: '2',
      name: 'test',
      contentType: 'pdf',
      file: filePath,
      screens: {},
      screenOrder: [],
      capture: false,
      activeShare: null,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    });
    // Trusts project.contentType === 'pdf' — uppercase extensions are valid.
    // v2 static-share rendering is permissive about extensions; live share
    // should match that permissiveness to avoid asymmetric behavior.
    const payload = await buildPdfLivePayload('p1');
    expect(payload).not.toBeNull();
    expect(payload!.mimeType).toBe('application/pdf');
  });
});
