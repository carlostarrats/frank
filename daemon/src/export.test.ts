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

import { exportProject } from './export.js';
import { createProject, addComment } from './projects.js';
import { saveSnapshot, starSnapshot } from './snapshots.js';
import { addCuration, applyCurationToComments } from './curation.js';
import { addAiInstruction, linkSnapshotToInstruction } from './ai-chain.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-export-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('exportProject', () => {
  it('exports an empty project', () => {
    const { projectId } = createProject('Export Empty', 'url', 'https://example.com');
    const result = exportProject(projectId);
    expect(result.frank_export_version).toBe('1');
    expect(result.exportedAt).toBeTruthy();
    expect(result.project.name).toBe('Export Empty');
    expect(result.project.url).toBe('https://example.com');
    expect(result.project.contentType).toBe('url');
    expect(result.project.screens).toEqual([]);
    expect(result.snapshots).toEqual([]);
    expect(result.comments).toEqual([]);
    expect(result.curations).toEqual([]);
    expect(result.aiInstructions).toEqual([]);
    expect(result.timeline).toEqual([]);
  });

  it('exports a full project with all data types', () => {
    const { projectId } = createProject('Full Export', 'url', 'https://example.com');

    // Add a comment
    const comment = addComment(projectId, {
      screenId: 'screen-1',
      anchor: { type: 'pin', x: 50, y: 50 },
      author: 'Tester',
      text: 'Fix this layout',
    });

    // Curate the comment
    const curation = addCuration(projectId, [comment.id], 'approve', [comment.text]);
    applyCurationToComments(projectId, [comment.id], 'approved');

    // Save a snapshot
    const snap = saveSnapshot(projectId, '<html>snapshot</html>', null, 'manual');

    // Log an AI instruction
    const instruction = addAiInstruction(projectId, [comment.id], [curation.id], 'Implement the layout fix');
    linkSnapshotToInstruction(projectId, instruction.id, snap.id);

    const result = exportProject(projectId);

    // Comments
    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].text).toBe('Fix this layout');
    expect(result.comments[0].status).toBe('approved');
    expect(result.comments[0].author).toBe('Tester');

    // Curations
    expect(result.curations).toHaveLength(1);
    expect(result.curations[0].action).toBe('approve');
    expect(result.curations[0].commentIds).toEqual([comment.id]);

    // Snapshots
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0].trigger).toBe('manual');

    // AI Instructions
    expect(result.aiInstructions).toHaveLength(1);
    expect(result.aiInstructions[0].instruction).toBe('Implement the layout fix');
    expect(result.aiInstructions[0].resultSnapshot).toBe(snap.id);

    // Timeline includes all event types
    expect(result.timeline).toHaveLength(4);
    const types = result.timeline.map(t => t.type).sort();
    expect(types).toEqual(['ai_instruction', 'comment', 'curation', 'snapshot']);
  });

  it('timeline is sorted by timestamp ascending', () => {
    const { projectId } = createProject('Timeline Sort', 'url', 'https://example.com');

    addComment(projectId, {
      screenId: 's1',
      anchor: { type: 'pin', x: 10, y: 10 },
      author: 'A',
      text: 'First',
    });
    saveSnapshot(projectId, '<html/>', null, 'manual');
    addAiInstruction(projectId, [], [], 'Do something');

    const result = exportProject(projectId);
    for (let i = 1; i < result.timeline.length; i++) {
      expect(result.timeline[i].ts >= result.timeline[i - 1].ts).toBe(true);
    }
  });
});
