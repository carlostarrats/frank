import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Redirect PROJECTS_DIR to a temp dir for the whole suite.
vi.mock('./protocol.js', async () => {
  const mod = await vi.importActual<typeof import('./protocol.js')>('./protocol.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-rev-'));
  return { ...mod, PROJECTS_DIR: tmp };
});

import { PROJECTS_DIR } from './protocol.js';
import { loadRevision, saveRevision, nextRevision } from './revision-store.js';

function mkProject(id: string) {
  fs.mkdirSync(path.join(PROJECTS_DIR, id), { recursive: true });
}

describe('revision-store', () => {
  beforeEach(() => {
    for (const d of fs.readdirSync(PROJECTS_DIR)) {
      fs.rmSync(path.join(PROJECTS_DIR, d), { recursive: true, force: true });
    }
  });

  it('returns 0 for a project with no live.json', () => {
    mkProject('p1');
    expect(loadRevision('p1')).toBe(0);
  });

  it('persists a revision and reads it back', () => {
    mkProject('p1');
    saveRevision('p1', 42);
    expect(loadRevision('p1')).toBe(42);
  });

  it('nextRevision bumps monotonically across restarts', () => {
    mkProject('p1');
    expect(nextRevision('p1')).toBe(1);
    expect(nextRevision('p1')).toBe(2);
    expect(loadRevision('p1')).toBe(2);
    // Simulated restart: fresh call reads from disk and continues.
    expect(nextRevision('p1')).toBe(3);
  });

  it('fast-forwards when the backend revision is ahead', () => {
    mkProject('p1');
    saveRevision('p1', 5);
    saveRevision('p1', 10); // simulate backend catch-up
    expect(loadRevision('p1')).toBe(10);
    expect(nextRevision('p1')).toBe(11);
  });

  it('does not let nextRevision regress if saveRevision is called with a lower value', () => {
    mkProject('p1');
    saveRevision('p1', 100);
    // A stale "accepted" response should never lower the counter.
    saveRevision('p1', 50);
    expect(loadRevision('p1')).toBe(100);
  });
});
