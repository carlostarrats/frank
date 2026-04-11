import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return tmpDir; },
  };
});

import {
  saveSnapshot,
  listSnapshots,
  starSnapshot,
  unstarSnapshot,
  deleteSnapshot,
} from './snapshots.js';

function setupProject(projectId: string) {
  fs.mkdirSync(path.join(tmpDir, projectId, 'snapshots'), { recursive: true });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-snapshots-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('saveSnapshot', () => {
  it('creates snapshot directory with meta.json and snapshot.html', () => {
    setupProject('proj-1');
    const meta = saveSnapshot('proj-1', '<html>test</html>', null, 'manual');
    expect(meta.id).toMatch(/^snap-\d+-[a-f0-9]{6}$/);
    expect(meta.trigger).toBe('manual');
    expect(meta.starred).toBe(false);
    expect(meta.label).toBe('');
    expect(meta.frankVersion).toBe('2');

    const snapDir = path.join(tmpDir, 'proj-1', 'snapshots', meta.id);
    expect(fs.existsSync(path.join(snapDir, 'meta.json'))).toBe(true);
    expect(fs.existsSync(path.join(snapDir, 'snapshot.html'))).toBe(true);
    expect(fs.readFileSync(path.join(snapDir, 'snapshot.html'), 'utf8')).toBe('<html>test</html>');
  });

  it('saves screenshot when provided', () => {
    setupProject('proj-2');
    const base64 = Buffer.from('fake-png-data').toString('base64');
    const meta = saveSnapshot('proj-2', '<html/>', base64, 'share');
    const screenshotPath = path.join(tmpDir, 'proj-2', 'snapshots', meta.id, 'screenshot.png');
    expect(fs.existsSync(screenshotPath)).toBe(true);
    expect(fs.readFileSync(screenshotPath).toString()).toBe('fake-png-data');
  });

  it('does not create screenshot.png when null', () => {
    setupProject('proj-3');
    const meta = saveSnapshot('proj-3', '<html/>', null, 'manual');
    const screenshotPath = path.join(tmpDir, 'proj-3', 'snapshots', meta.id, 'screenshot.png');
    expect(fs.existsSync(screenshotPath)).toBe(false);
  });

  it('stores triggeredBy when provided', () => {
    setupProject('proj-4');
    const meta = saveSnapshot('proj-4', '<html/>', null, 'ai-applied', 'ai-instruction-123');
    expect(meta.triggeredBy).toBe('ai-instruction-123');
  });
});

describe('listSnapshots', () => {
  it('returns empty array when no snapshots exist', () => {
    setupProject('empty-proj');
    expect(listSnapshots('empty-proj')).toEqual([]);
  });

  it('returns empty array when snapshots dir does not exist', () => {
    expect(listSnapshots('nonexistent')).toEqual([]);
  });

  it('lists snapshots sorted by ts descending', () => {
    setupProject('proj-list');
    const s1 = saveSnapshot('proj-list', '<html>1</html>', null, 'manual');
    // Force different timestamps by patching the meta file
    const s1MetaPath = path.join(tmpDir, 'proj-list', 'snapshots', s1.id, 'meta.json');
    const s1Meta = JSON.parse(fs.readFileSync(s1MetaPath, 'utf8'));
    s1Meta.ts = '2024-01-01T00:00:00.000Z';
    fs.writeFileSync(s1MetaPath, JSON.stringify(s1Meta, null, 2));

    const s2 = saveSnapshot('proj-list', '<html>2</html>', null, 'manual');
    const s2MetaPath = path.join(tmpDir, 'proj-list', 'snapshots', s2.id, 'meta.json');
    const s2Meta = JSON.parse(fs.readFileSync(s2MetaPath, 'utf8'));
    s2Meta.ts = '2024-06-01T00:00:00.000Z';
    fs.writeFileSync(s2MetaPath, JSON.stringify(s2Meta, null, 2));

    const snapshots = listSnapshots('proj-list');
    expect(snapshots).toHaveLength(2);
    // Most recent first
    expect(snapshots[0].id).toBe(s2.id);
    expect(snapshots[1].id).toBe(s1.id);
  });
});

describe('starSnapshot', () => {
  it('marks a snapshot as starred with a label', () => {
    setupProject('proj-star');
    const s = saveSnapshot('proj-star', '<html/>', null, 'manual');
    const result = starSnapshot('proj-star', s.id, 'Important version');
    expect(result).not.toBeNull();
    expect(result!.starred).toBe(true);
    expect(result!.label).toBe('Important version');

    // Verify persistence
    const list = listSnapshots('proj-star');
    expect(list[0].starred).toBe(true);
    expect(list[0].label).toBe('Important version');
  });

  it('returns null for nonexistent snapshot', () => {
    setupProject('proj-star-missing');
    expect(starSnapshot('proj-star-missing', 'snap-nonexistent', 'X')).toBeNull();
  });
});

describe('unstarSnapshot', () => {
  it('clears starred flag and label', () => {
    setupProject('proj-unstar');
    const s = saveSnapshot('proj-unstar', '<html/>', null, 'manual');
    starSnapshot('proj-unstar', s.id, 'Labeled');
    const result = unstarSnapshot('proj-unstar', s.id);
    expect(result!.starred).toBe(false);
    expect(result!.label).toBe('');
  });
});

describe('deleteSnapshot', () => {
  it('removes the snapshot directory', () => {
    setupProject('proj-del');
    const s = saveSnapshot('proj-del', '<html/>', null, 'manual');
    expect(deleteSnapshot('proj-del', s.id)).toBe(true);
    expect(listSnapshots('proj-del')).toHaveLength(0);
  });

  it('returns false for nonexistent snapshot', () => {
    setupProject('proj-del-miss');
    expect(deleteSnapshot('proj-del-miss', 'snap-nope')).toBe(false);
  });
});
