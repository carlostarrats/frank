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

import { addCuration, applyCurationToComments, loadCurations } from './curation.js';
import type { Comment } from './protocol.js';

function setupProject(projectId: string, comments: Comment[] = []) {
  const dir = path.join(tmpDir, projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'comments.json'), JSON.stringify(comments, null, 2));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-curation-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadCurations', () => {
  it('returns empty array when file does not exist', () => {
    fs.mkdirSync(path.join(tmpDir, 'empty'), { recursive: true });
    expect(loadCurations('empty')).toEqual([]);
  });
});

describe('addCuration', () => {
  it('creates an approve curation entry', () => {
    setupProject('cur-1');
    const entry = addCuration('cur-1', ['c-1'], 'approve', ['Original text']);
    expect(entry.id).toMatch(/^cur-\d+-[a-f0-9]{6}$/);
    expect(entry.action).toBe('approve');
    expect(entry.commentIds).toEqual(['c-1']);
    expect(entry.originalTexts).toEqual(['Original text']);
    expect(entry.remixedText).toBe('');
    expect(entry.dismissReason).toBe('');
  });

  it('creates a dismiss curation with reason', () => {
    setupProject('cur-2');
    const entry = addCuration('cur-2', ['c-2'], 'dismiss', ['Bad feedback'], '', 'Not actionable');
    expect(entry.action).toBe('dismiss');
    expect(entry.dismissReason).toBe('Not actionable');
  });

  it('creates a remix curation with remixed text', () => {
    setupProject('cur-3');
    const entry = addCuration('cur-3', ['c-3'], 'remix', ['Original'], 'Improved version');
    expect(entry.action).toBe('remix');
    expect(entry.remixedText).toBe('Improved version');
  });

  it('persists curations to disk', () => {
    setupProject('cur-persist');
    addCuration('cur-persist', ['c-1'], 'approve', ['Text 1']);
    addCuration('cur-persist', ['c-2'], 'dismiss', ['Text 2'], '', 'Reason');
    const loaded = loadCurations('cur-persist');
    expect(loaded).toHaveLength(2);
    expect(loaded[0].action).toBe('approve');
    expect(loaded[1].action).toBe('dismiss');
  });

  it('handles batch action with multiple comment ids', () => {
    setupProject('cur-batch');
    const entry = addCuration('cur-batch', ['c-1', 'c-2', 'c-3'], 'batch', ['T1', 'T2', 'T3']);
    expect(entry.commentIds).toHaveLength(3);
    expect(entry.action).toBe('batch');
  });
});

describe('applyCurationToComments', () => {
  it('updates comment statuses to approved', () => {
    const comments: Comment[] = [
      { id: 'c-1', screenId: 's1', anchor: { type: 'pin', x: 10, y: 10 }, author: 'A', text: 'T1', ts: '2024-01-01', status: 'pending' },
      { id: 'c-2', screenId: 's1', anchor: { type: 'pin', x: 20, y: 20 }, author: 'B', text: 'T2', ts: '2024-01-01', status: 'pending' },
      { id: 'c-3', screenId: 's1', anchor: { type: 'pin', x: 30, y: 30 }, author: 'C', text: 'T3', ts: '2024-01-01', status: 'pending' },
    ];
    setupProject('apply-1', comments);
    applyCurationToComments('apply-1', ['c-1', 'c-3'], 'approved');

    const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'apply-1', 'comments.json'), 'utf8'));
    expect(updated[0].status).toBe('approved');
    expect(updated[1].status).toBe('pending');
    expect(updated[2].status).toBe('approved');
  });

  it('updates comment statuses to dismissed', () => {
    const comments: Comment[] = [
      { id: 'c-1', screenId: 's1', anchor: { type: 'pin', x: 10, y: 10 }, author: 'A', text: 'T1', ts: '2024-01-01', status: 'pending' },
    ];
    setupProject('apply-2', comments);
    applyCurationToComments('apply-2', ['c-1'], 'dismissed');

    const updated = JSON.parse(fs.readFileSync(path.join(tmpDir, 'apply-2', 'comments.json'), 'utf8'));
    expect(updated[0].status).toBe('dismissed');
  });

  it('does nothing when comments file does not exist', () => {
    fs.mkdirSync(path.join(tmpDir, 'no-comments'), { recursive: true });
    expect(() => applyCurationToComments('no-comments', ['c-1'], 'approved')).not.toThrow();
  });
});
