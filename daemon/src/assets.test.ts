import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

let tmpDir: string;

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return tmpDir; },
    get FRANK_DIR() { return path.dirname(tmpDir); },
    get CONFIG_PATH() { return path.join(path.dirname(tmpDir), 'config.json'); },
  };
});

import { saveAsset, ALLOWED_MIME_TYPES } from './assets.js';
import { createProjectFromFile, loadProject } from './projects.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-assets-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('saveAsset', () => {
  it('writes the file and returns content-addressed metadata', () => {
    const buffer = Buffer.from('fake png bytes');
    const asset = saveAsset('p-test', buffer, 'image/png');

    const expectedSha = crypto.createHash('sha256').update(buffer).digest('hex');
    expect(asset.assetId).toBe(expectedSha);
    expect(asset.filename).toBe(`${expectedSha}.png`);
    expect(asset.bytes).toBe(buffer.length);
    expect(asset.url).toBe(`/files/projects/p-test/assets/${expectedSha}.png`);

    const onDisk = path.join(tmpDir, 'p-test', 'assets', `${expectedSha}.png`);
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.readFileSync(onDisk)).toEqual(buffer);
  });

  it('deduplicates identical bytes across repeated saves', () => {
    const buffer = Buffer.from('duplicate');
    const a = saveAsset('p-dup', buffer, 'image/png');
    const b = saveAsset('p-dup', buffer, 'image/png');
    expect(a.assetId).toBe(b.assetId);
    expect(a.filename).toBe(b.filename);
    const entries = fs.readdirSync(path.join(tmpDir, 'p-dup', 'assets'));
    expect(entries).toHaveLength(1);
  });

  it('rejects unsupported mime types', () => {
    expect(() => saveAsset('p', Buffer.from('x'), 'application/zip')).toThrow(/Unsupported/);
  });

  it('publishes an allowlist of mime types', () => {
    expect(ALLOWED_MIME_TYPES).toContain('image/png');
    expect(ALLOWED_MIME_TYPES).toContain('image/jpeg');
    expect(ALLOWED_MIME_TYPES).toContain('application/pdf');
  });
});

describe('createProjectFromFile', () => {
  it('creates a PDF project with the file saved under source/', () => {
    const bytes = Buffer.from('%PDF-1.4 fake pdf bytes');
    const { project, projectId } = createProjectFromFile('Design Spec', 'pdf', 'spec.pdf', bytes);

    expect(project.contentType).toBe('pdf');
    expect(project.file).toBe(`projects/${projectId}/source/spec.pdf`);
    const onDisk = path.join(tmpDir, projectId, 'source', 'spec.pdf');
    expect(fs.existsSync(onDisk)).toBe(true);
    expect(fs.readFileSync(onDisk)).toEqual(bytes);
  });

  it('creates an image project with sanitized filename', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const { project, projectId } = createProjectFromFile('Mockup', 'image', 'my file?!.png', bytes);

    expect(project.contentType).toBe('image');
    // `?!` collapse to a single `_`; spaces, hyphens, and dots are preserved.
    expect(project.file).toMatch(/^projects\/.+\/source\/my file_\.png$/);
    expect(fs.existsSync(path.join(tmpDir, projectId, 'source', 'my file_.png'))).toBe(true);
  });

  it('persists project.json that loadProject can read back', () => {
    const { projectId } = createProjectFromFile('Roundtrip', 'pdf', 'r.pdf', Buffer.from('x'));
    const loaded = loadProject(projectId);
    expect(loaded.name).toBe('Roundtrip');
    expect(loaded.contentType).toBe('pdf');
  });
});
