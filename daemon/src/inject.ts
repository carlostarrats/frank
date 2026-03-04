// Manages two injections made on `lookyloo start` and removed on `lookyloo stop`:
//
//   1. ~/.claude/CLAUDE.md  — instructs Claude to write schemas to /tmp/lookyloo/
//   2. ~/.claude/settings.json — registers the PostToolUse hook
//
// Both injections are idempotent (safe to run multiple times) and cleanly reversible.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SCHEMA_DIR, INJECT_MARKER_START, INJECT_MARKER_END, SETTINGS_HOOK_MARKER } from './protocol.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

const CLAUDE_MD_BLOCK = `
${INJECT_MARKER_START}
## Looky Loo — Visual Rendering Companion

When you generate a UI layout, screen design, wireframe, or multi-screen flow, do the following before writing your response:

1. Create a Looky Loo v1 schema JSON describing the layout
2. Write the schema to \`${SCHEMA_DIR}/render-<ISO-timestamp>.json\` using the Write tool (e.g. \`${SCHEMA_DIR}/render-2025-03-03T14-34-00.json\`)
3. Then continue with your normal conversational response

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
      "type": "header" | "hero" | "content" | "top-nav" | "bottom-nav" | "sidebar" | "form" | "list" | "grid" | "footer" | "empty-state" | "banner" | "toolbar" | "modal",
      "contains": ["element 1", "element 2"],
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
  "design_language": {
    "nav_position": "top" | "bottom" | "sidebar" | "none",
    "header_style": "minimal" | "prominent" | "none",
    "card_style": "rounded-lg shadow-sm",
    "spacing": "compact" | "comfortable" | "spacious",
    "color_scheme": "light" | "dark" | "neutral"
  },
  "screens": [
    { "label": "Screen Name", "sections": [ /* same as above */ ] }
  ]
}
\`\`\`

Only generate a schema when output clearly describes a UI layout, screen, or flow. Do not generate schemas for code explanations, architecture decisions, or non-visual content.

For multi-screen flows: establish the full flow structure and shared design_language first, then generate each screen sequentially so they are visually coherent.
${INJECT_MARKER_END}
`;

export function injectClaudeMd(): void {
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);
  if (existing.includes(INJECT_MARKER_START)) {
    console.log('[lookyloo] CLAUDE.md: already injected');
    return;
  }
  const updated = existing.trimEnd() + '\n' + CLAUDE_MD_BLOCK;
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  fs.writeFileSync(CLAUDE_MD_PATH, updated, 'utf8');
  console.log('[lookyloo] CLAUDE.md: injected');
}

export function removeClaudeMd(): void {
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);
  if (!existing.includes(INJECT_MARKER_START)) {
    console.log('[lookyloo] CLAUDE.md: nothing to remove');
    return;
  }
  const updated = removeBlock(existing, INJECT_MARKER_START, INJECT_MARKER_END);
  fs.writeFileSync(CLAUDE_MD_PATH, updated, 'utf8');
  console.log('[lookyloo] CLAUDE.md: removed');
}

// ─── settings.json ────────────────────────────────────────────────────────────

const HOOK_ENTRY = {
  type: 'command',
  command: `lookyloo hook # ${SETTINGS_HOOK_MARKER}`,
  timeout: 10,
};

const HOOK_MATCHER = 'Write';

export function injectSettingsHook(): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const settings = readSettingsJson();

  const existingHooks: unknown[] = (settings['PostToolUse'] as unknown[]) ?? [];

  // Check if already injected
  const alreadyPresent = existingHooks.some(
    (h) =>
      typeof h === 'object' &&
      h !== null &&
      (h as Record<string, unknown>)['matcher'] === HOOK_MATCHER &&
      Array.isArray((h as Record<string, unknown>)['hooks']) &&
      ((h as Record<string, unknown>)['hooks'] as unknown[]).some(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as Record<string, unknown>)['command'] ===
            `lookyloo hook # ${SETTINGS_HOOK_MARKER}`
      )
  );

  if (alreadyPresent) {
    console.log('[lookyloo] settings.json: hook already registered');
    return;
  }

  const newEntry = {
    matcher: HOOK_MATCHER,
    hooks: [HOOK_ENTRY],
  };

  settings['PostToolUse'] = [...existingHooks, newEntry];
  writeSettingsJson(settings);
  console.log('[lookyloo] settings.json: hook registered');
}

export function removeSettingsHook(): void {
  const settings = readSettingsJson();
  const existingHooks = (settings['PostToolUse'] as unknown[]) ?? [];

  const filtered = existingHooks.filter((h) => {
    if (typeof h !== 'object' || h === null) return true;
    const entry = h as Record<string, unknown>;
    if (entry['matcher'] !== HOOK_MATCHER) return true;
    const hooks = (entry['hooks'] as unknown[]) ?? [];
    // Remove this matcher block if it only contains our hook
    const ours = hooks.filter(
      (hook) =>
        typeof hook === 'object' &&
        hook !== null &&
        (hook as Record<string, unknown>)['command'] ===
          `lookyloo hook # ${SETTINGS_HOOK_MARKER}`
    );
    return ours.length === 0; // Keep blocks that don't contain our hook
  });

  if (filtered.length === 0) {
    delete settings['PostToolUse'];
  } else {
    settings['PostToolUse'] = filtered;
  }

  writeSettingsJson(settings);
  console.log('[lookyloo] settings.json: hook removed');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function readFileOrEmpty(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function readSettingsJson(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeSettingsJson(settings: Record<string, unknown>): void {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function removeBlock(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1) return text;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end + endMarker.length).trimStart();
  return before + (after ? '\n\n' + after : '') + '\n';
}
