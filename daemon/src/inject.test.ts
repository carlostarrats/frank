import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';

// vi.hoisted runs before vi.mock hoisting, so TEST_HOME is available in mock factories
const { TEST_HOME } = vi.hoisted(() => {
  const { mkdtempSync } = require('fs');
  const { join } = require('path');
  const { tmpdir } = require('os');
  return { TEST_HOME: mkdtempSync(join(tmpdir(), 'frank-test-inject-')) };
});

vi.mock('os', async () => {
  const actual = await vi.importActual('os') as any;
  return {
    ...actual,
    default: {
      ...actual.default,
      homedir: () => TEST_HOME,
    },
    homedir: () => TEST_HOME,
  };
});

vi.mock('./protocol.js', () => ({
  INJECT_MARKER_START: '<!-- FRANK:START -->',
  INJECT_MARKER_END: '<!-- FRANK:END -->',
}));

import { injectClaudeMd, removeClaudeMd, updateInjectionProjectPath } from './inject.js';

const claudeMdPath = path.join(TEST_HOME, '.claude', 'CLAUDE.md');

beforeEach(() => {
  const claudeDir = path.join(TEST_HOME, '.claude');
  if (fs.existsSync(claudeDir)) {
    fs.rmSync(claudeDir, { recursive: true, force: true });
  }
});

afterAll(() => {
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

describe('injectClaudeMd', () => {
  it('creates CLAUDE.md with Frank block when file does not exist', () => {
    injectClaudeMd();
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain('<!-- FRANK:START -->');
    expect(content).toContain('<!-- FRANK:END -->');
    expect(content).toContain('Frank is running');
  });

  it('appends Frank block to existing CLAUDE.md', () => {
    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, '# Existing content\n\nSome stuff here.\n');
    injectClaudeMd();
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain('# Existing content');
    expect(content).toContain('<!-- FRANK:START -->');
  });

  it('is idempotent — does not double inject', () => {
    injectClaudeMd();
    const firstContent = fs.readFileSync(claudeMdPath, 'utf8');
    injectClaudeMd();
    const secondContent = fs.readFileSync(claudeMdPath, 'utf8');
    expect(secondContent).toBe(firstContent);
  });
});

describe('removeClaudeMd', () => {
  it('removes the Frank block from CLAUDE.md', () => {
    injectClaudeMd();
    removeClaudeMd();
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).not.toContain('<!-- FRANK:START -->');
    expect(content).not.toContain('<!-- FRANK:END -->');
    expect(content).not.toContain('Frank is running');
  });

  it('preserves other content when removing', () => {
    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, '# My notes\n\nKeep this.\n');
    injectClaudeMd();
    removeClaudeMd();
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain('# My notes');
    expect(content).toContain('Keep this.');
  });

  it('does nothing when no injection exists', () => {
    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, '# Clean file\n');
    removeClaudeMd();
    expect(fs.readFileSync(claudeMdPath, 'utf8')).toBe('# Clean file\n');
  });
});

describe('updateInjectionProjectPath', () => {
  it('adds active project line to injected block', () => {
    injectClaudeMd();
    updateInjectionProjectPath('/Users/test/.frank/projects/my-project');
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).toContain('Active project:');
    expect(content).toContain('my-project');
  });

  it('updates existing active project line', () => {
    injectClaudeMd();
    updateInjectionProjectPath('/Users/test/.frank/projects/first');
    updateInjectionProjectPath('/Users/test/.frank/projects/second');
    const content = fs.readFileSync(claudeMdPath, 'utf8');
    expect(content).not.toContain('first');
    expect(content).toContain('second');
  });

  it('does nothing when no injection exists', () => {
    fs.mkdirSync(path.dirname(claudeMdPath), { recursive: true });
    fs.writeFileSync(claudeMdPath, '# No Frank block\n');
    updateInjectionProjectPath('/some/path');
    expect(fs.readFileSync(claudeMdPath, 'utf8')).toBe('# No Frank block\n');
  });
});
