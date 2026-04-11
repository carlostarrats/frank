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

import { addAiInstruction, linkSnapshotToInstruction, loadAiChain } from './ai-chain.js';

function setupProject(projectId: string) {
  fs.mkdirSync(path.join(tmpDir, projectId), { recursive: true });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-ai-chain-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadAiChain', () => {
  it('returns empty array when file does not exist', () => {
    setupProject('empty');
    expect(loadAiChain('empty')).toEqual([]);
  });
});

describe('addAiInstruction', () => {
  it('creates an AI instruction entry', () => {
    setupProject('ai-1');
    const entry = addAiInstruction('ai-1', ['c-1', 'c-2'], ['cur-1'], 'Fix the button color to blue');
    expect(entry.id).toMatch(/^ai-\d+-[a-f0-9]{6}$/);
    expect(entry.feedbackIds).toEqual(['c-1', 'c-2']);
    expect(entry.curationIds).toEqual(['cur-1']);
    expect(entry.instruction).toBe('Fix the button color to blue');
    expect(entry.resultSnapshot).toBeNull();
    expect(entry.ts).toBeTruthy();
  });

  it('persists multiple instructions', () => {
    setupProject('ai-persist');
    addAiInstruction('ai-persist', ['c-1'], [], 'First instruction');
    addAiInstruction('ai-persist', ['c-2'], [], 'Second instruction');
    const chain = loadAiChain('ai-persist');
    expect(chain).toHaveLength(2);
    expect(chain[0].instruction).toBe('First instruction');
    expect(chain[1].instruction).toBe('Second instruction');
  });
});

describe('linkSnapshotToInstruction', () => {
  it('links a snapshot to an existing instruction', () => {
    setupProject('ai-link');
    const entry = addAiInstruction('ai-link', ['c-1'], [], 'Do something');
    linkSnapshotToInstruction('ai-link', entry.id, 'snap-abc');

    const chain = loadAiChain('ai-link');
    expect(chain[0].resultSnapshot).toBe('snap-abc');
  });

  it('does nothing for nonexistent instruction id', () => {
    setupProject('ai-link-miss');
    addAiInstruction('ai-link-miss', ['c-1'], [], 'Real instruction');
    linkSnapshotToInstruction('ai-link-miss', 'ai-nonexistent', 'snap-xyz');

    const chain = loadAiChain('ai-link-miss');
    expect(chain[0].resultSnapshot).toBeNull();
  });
});
