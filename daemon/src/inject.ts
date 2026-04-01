// Manages the CLAUDE.md injection made on `frank start` and removed on `frank stop`.
// Idempotent (safe to run multiple times) and cleanly reversible.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { INJECT_MARKER_START, INJECT_MARKER_END } from './protocol.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md');

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

const CLAUDE_MD_BLOCK = `
${INJECT_MARKER_START}
## Frank — Collaboration Layer

Frank is running. It wraps web content with commenting, feedback routing, and decision capture.

When reviewing designs or giving feedback, Frank will capture your comments directly on the live content.

Run \`frank start\` in your terminal to open the Frank panel.
${INJECT_MARKER_END}
`;

export function injectClaudeMd(): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);

  if (existing.includes(INJECT_MARKER_START)) {
    console.log('[frank] CLAUDE.md: already injected');
    return;
  }

  const updated = existing.trimEnd() + '\n' + CLAUDE_MD_BLOCK;
  fs.writeFileSync(CLAUDE_MD_PATH, updated, 'utf8');
  console.log('[frank] CLAUDE.md: injected');
}

export function removeClaudeMd(): void {
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);
  if (!existing.includes(INJECT_MARKER_START)) {
    console.log('[frank] CLAUDE.md: nothing to remove');
    return;
  }
  const updated = removeBlock(existing, INJECT_MARKER_START, INJECT_MARKER_END);
  fs.writeFileSync(CLAUDE_MD_PATH, updated, 'utf8');
  console.log('[frank] CLAUDE.md: removed');
}

// ─── Project path tracking ───────────────────────────────────────────────────

const ACTIVE_PROJECT_LINE_PREFIX = 'Active project: ';

export function updateInjectionProjectPath(projectPath: string): void {
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);
  if (!existing.includes(INJECT_MARKER_START)) return;

  const startIdx = existing.indexOf(INJECT_MARKER_START);
  const endIdx = existing.indexOf(INJECT_MARKER_END);
  if (startIdx === -1 || endIdx === -1) return;

  const before = existing.slice(0, startIdx);
  const block = existing.slice(startIdx, endIdx + INJECT_MARKER_END.length);
  const after = existing.slice(endIdx + INJECT_MARKER_END.length);

  // Replace home dir with ~ for readability
  const displayPath = projectPath.replace(process.env.HOME || '', '~');
  const newLine = `${ACTIVE_PROJECT_LINE_PREFIX}${displayPath}`;

  // Check if there's already an "Active project:" line in the block
  const lines = block.split('\n');
  const existingLineIdx = lines.findIndex(l => l.startsWith(ACTIVE_PROJECT_LINE_PREFIX));

  if (existingLineIdx !== -1) {
    lines[existingLineIdx] = newLine;
  } else {
    // Insert before the end marker
    const endMarkerIdx = lines.findIndex(l => l.includes(INJECT_MARKER_END));
    lines.splice(endMarkerIdx, 0, '', newLine);
  }

  const updatedBlock = lines.join('\n');
  fs.writeFileSync(CLAUDE_MD_PATH, before + updatedBlock + after, 'utf8');
  console.log(`[frank] CLAUDE.md: updated active project to ${displayPath}`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function removeBlock(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1) return text;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end + endMarker.length).trimStart();
  return before + (after ? '\n\n' + after : '') + '\n';
}
