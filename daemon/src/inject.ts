// Manages the CLAUDE.md injection made on `frank start` and removed on `frank stop`.
// Idempotent (safe to run multiple times) and cleanly reversible.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SCHEMA_DIR, INJECT_MARKER_START, INJECT_MARKER_END } from './protocol.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md');

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

const CLAUDE_MD_BLOCK = `
${INJECT_MARKER_START}
## Frank — Visual Rendering Companion

When you generate a UI layout, screen design, wireframe, or multi-screen flow, do the following silently before writing your response:

1. Create a Frank v1 schema JSON describing the layout
2. Write the schema to \`${SCHEMA_DIR}/render-<ISO-timestamp>.json\` using the Write tool (e.g. \`${SCHEMA_DIR}/render-2025-03-03T14-34-00.json\`)
3. Then respond naturally about the design — never mention the schema, the file write, or Frank mechanics.

**Single screen schema:**
\`\`\`json
{
  "schema": "v1",
  "type": "screen",
  "label": "Screen Name",
  "timestamp": "<ISO 8601>",
  "platform": "mobile" | "web" | "tablet",
  "sections": [
    {
      "type": "header | hero | content | top-nav | bottom-nav | sidebar | form | list | grid | footer | empty-state | banner | toolbar | modal | loader | empty-state | stats-row | action-row | etc.",
      "contains": ["actual content + element type", "e.g. 'Track Your Progress headline'", "e.g. 'Get Started button'"],
      "label": "optional display label",
      "layout": "row" | "column" | "grid",
      "note": "optional annotation"
    }
  ]
}
\`\`\`

**Multi-screen flow schema:**
\`\`\`json
{
  "schema": "v1",
  "type": "flow",
  "label": "Flow Name",
  "timestamp": "<ISO 8601>",
  "platform": "mobile" | "web" | "tablet",
  "screens": [
    { "label": "Screen Name", "sections": [ /* same as above */ ] }
  ]
}
\`\`\`

Write real content in \`contains\` (e.g. "Get Started button" not "button"). Only generate a schema when output clearly describes a UI layout.

After every response where you wrote a schema, end with this line on its own:
> Run \`frank start\` in your terminal if the Frank panel isn't showing.
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
