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
    get FRANK_DIR() { return path.dirname(tmpDir); },
    get CONFIG_PATH() { return path.join(path.dirname(tmpDir), 'config.json'); },
  };
});

import { buildReportData, renderReportMarkdown, renderReportPdf } from './report.js';
import { createProject, addComment } from './projects.js';
import { addCuration, applyCurationToComments } from './curation.js';
import { saveSnapshot } from './snapshots.js';
import { addAiInstruction } from './ai-chain.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-report-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('buildReportData', () => {
  it('returns empty summary for a fresh project', () => {
    const { projectId } = createProject('Empty', 'url', 'https://example.com');
    const data = buildReportData(projectId);
    expect(data.project.name).toBe('Empty');
    expect(data.summary.totalComments).toBe(0);
    expect(data.summary.snapshots).toBe(0);
    expect(data.comments).toHaveLength(0);
  });

  it('aggregates comment statuses into summary counts', () => {
    const { projectId } = createProject('Stats', 'url', 'https://x.com');
    const c1 = addComment(projectId, { screenId: 's', anchor: { type: 'pin', x: 10, y: 10 }, author: 'A', text: 'One' });
    const c2 = addComment(projectId, { screenId: 's', anchor: { type: 'pin', x: 20, y: 20 }, author: 'B', text: 'Two' });
    addComment(projectId, { screenId: 's', anchor: { type: 'pin', x: 30, y: 30 }, author: 'C', text: 'Three' });

    // Mark statuses via curation.
    addCuration(projectId, [c1.id], 'approve', ['One'], '', '');
    applyCurationToComments(projectId, [c1.id], 'approved');
    addCuration(projectId, [c2.id], 'dismiss', ['Two'], '', 'too vague');
    applyCurationToComments(projectId, [c2.id], 'dismissed');

    const data = buildReportData(projectId);
    expect(data.summary.totalComments).toBe(3);
    expect(data.summary.approvedComments).toBe(1);
    expect(data.summary.dismissedComments).toBe(1);
    expect(data.summary.remixedComments).toBe(0);
    expect(data.curations).toHaveLength(2);
  });

  it('includes snapshots + AI instructions in the report', () => {
    const { projectId } = createProject('Full', 'url', 'https://x.com');
    saveSnapshot(projectId, '<html></html>', null, 'manual', 'user');
    addAiInstruction(projectId, [], [], 'Refactor the auth flow');

    const data = buildReportData(projectId);
    expect(data.summary.snapshots).toBe(1);
    expect(data.summary.aiInstructions).toBe(1);
    expect(data.aiInstructions[0].instruction).toBe('Refactor the auth flow');
  });
});

describe('renderReportMarkdown', () => {
  it('includes project header and summary block', () => {
    const { projectId } = createProject('Render Test', 'url', 'https://example.com');
    addComment(projectId, { screenId: 's', anchor: { type: 'pin', x: 10, y: 10 }, author: 'Alice', text: 'Looks good.' });

    const data = buildReportData(projectId);
    const md = renderReportMarkdown(data);

    expect(md).toContain('# Render Test');
    expect(md).toContain('**URL:** https://example.com');
    expect(md).toContain('## Summary');
    expect(md).toContain('Total comments: **1**');
    expect(md).toContain('## Comments');
    expect(md).toContain('Alice');
    expect(md).toContain('Looks good.');
  });

  it('omits empty sections', () => {
    const { projectId } = createProject('Lean', 'url', 'https://x.com');
    const md = renderReportMarkdown(buildReportData(projectId));
    expect(md).toContain('## Summary');
    expect(md).not.toContain('## Comments');
    expect(md).not.toContain('## Decisions');
    expect(md).not.toContain('## Snapshots');
  });
});

describe('renderReportPdf', () => {
  it('produces a valid PDF buffer with the PDF magic bytes', async () => {
    const { projectId } = createProject('PDF Test', 'url', 'https://example.com');
    addComment(projectId, { screenId: 's', anchor: { type: 'pin', x: 10, y: 10 }, author: 'Alice', text: 'Hello' });

    const data = buildReportData(projectId);
    const buf = await renderReportPdf(data);

    expect(Buffer.isBuffer(buf)).toBe(true);
    // PDF magic: %PDF
    expect(buf[0]).toBe(0x25);
    expect(buf[1]).toBe(0x50);
    expect(buf[2]).toBe(0x44);
    expect(buf[3]).toBe(0x46);
    // Should be at least a few KB of content.
    expect(buf.length).toBeGreaterThan(1000);
  }, 30000);
});
