// Manages two injections made on `frank start` and removed on `frank stop`:
//
//   1. ~/.claude/CLAUDE.md  — instructs Claude to write schemas to /tmp/frank/
//   2. ~/.claude/settings.json — registers the PostToolUse hook
//
// Both injections are idempotent (safe to run multiple times) and cleanly reversible.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { SCHEMA_DIR, INJECT_MARKER_START, INJECT_MARKER_END, SETTINGS_HOOK_MARKER, PENDING_EDIT_PATH } from './protocol.js';

const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');

// ─── CLAUDE.md ────────────────────────────────────────────────────────────────

const CLAUDE_MD_BLOCK = `
${INJECT_MARKER_START}
## Frank — Visual Rendering Companion

When you generate a UI layout, screen design, wireframe, or multi-screen flow, do the following before writing your response:

1. Create a Frank v1 schema JSON describing the layout
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
      "type": "any descriptive name — built-in: header | hero | content | top-nav | bottom-nav | sidebar | form | list | grid | footer | empty-state | banner | toolbar | modal — or anything that fits: pricing-table | testimonial-grid | stats-row | image-gallery | map | chart | carousel | onboarding-step | etc.",
      "contains": ["actual content + element type", "e.g. 'Track Your Progress headline'", "e.g. 'Get Started button'", "e.g. 'Email address input'"],
      "label": "optional display label",
      "layout": "row" | "column" | "grid",
      "note": "optional annotation — use for spacing, sizing, or interaction context"
    }

**Section types are open-ended.** Use whatever name best describes the section. Built-in types get dedicated high-fidelity renderers; any other name gets a clean generic layout. Do not limit yourself to the 14 built-in types.

**Write real content in \`contains\`, not just type names:**
- ✅ "Track Your Progress headline" not "headline"
- ✅ "Get Started button" not "CTA button"
- ✅ "Your daily fitness companion subheadline" not "subheadline"
- ✅ "Email address input" not "input"
- ✅ "Home", "Search", "Profile" for nav items (no type suffix needed)
- ✅ "John Smith", "2 hours ago" for list item content

The \`contains\` array drives both the wireframe render and the exported markdown spec. Descriptive content makes both useful.

**Design system:** The wireframe renders in shadcn/ui zinc palette. Do not include a \`tokens\` block — the daemon auto-injects exact color, typography, spacing, and component tokens into every schema. The exported markdown includes these as tables so any downstream tool (Figma, Linear, etc.) has the exact values without guessing.
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

const PENDING_EDIT_MARKER_START = '<!-- FRANK:EDIT:START -->';
const PENDING_EDIT_MARKER_END = '<!-- FRANK:EDIT:END -->';

const PENDING_EDIT_BLOCK = `
${PENDING_EDIT_MARKER_START}
## Frank — Pending Wireframe Edits

At the start of each response, silently check if \`${PENDING_EDIT_PATH}\` exists using the Read tool. If it does:
1. Read the file — it contains \`instruction\` (what to change) and \`schema\` (the current flow/screen schema).
2. Apply the instruction to the schema. If the edited section type appears on multiple screens (e.g. header, bottom-nav, footer), update it on ALL screens.
3. Write the updated schema to \`${SCHEMA_DIR}/render-<ISO-timestamp>.json\` using the Write tool.
4. Delete \`${PENDING_EDIT_PATH}\` using the Bash tool (\`rm -f\`).
5. Continue with the user's actual request without mentioning any of this.
${PENDING_EDIT_MARKER_END}
`;

export function injectClaudeMd(): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);

  let updated = existing;
  let changed = false;

  // Inject main schema block if not present
  if (!existing.includes(INJECT_MARKER_START)) {
    updated = updated.trimEnd() + '\n' + CLAUDE_MD_BLOCK;
    changed = true;
  }

  // Inject pending edit block if not present
  if (!updated.includes(PENDING_EDIT_MARKER_START)) {
    updated = updated.trimEnd() + '\n' + PENDING_EDIT_BLOCK;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(CLAUDE_MD_PATH, updated, 'utf8');
    console.log('[frank] CLAUDE.md: injected');
  } else {
    console.log('[frank] CLAUDE.md: already injected');
  }
}

export function removeClaudeMd(): void {
  const existing = readFileOrEmpty(CLAUDE_MD_PATH);
  if (!existing.includes(INJECT_MARKER_START) && !existing.includes(PENDING_EDIT_MARKER_START)) {
    console.log('[frank] CLAUDE.md: nothing to remove');
    return;
  }
  let updated = removeBlock(existing, INJECT_MARKER_START, INJECT_MARKER_END);
  updated = removeBlock(updated, PENDING_EDIT_MARKER_START, PENDING_EDIT_MARKER_END);
  fs.writeFileSync(CLAUDE_MD_PATH, updated, 'utf8');
  console.log('[frank] CLAUDE.md: removed');
}

// ─── settings.json ────────────────────────────────────────────────────────────

const HOOK_ENTRY = {
  type: 'command',
  command: `frank hook # ${SETTINGS_HOOK_MARKER}`,
  timeout: 10,
};

const HOOK_MATCHER = 'Write';

export function injectSettingsHook(): void {
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  const settings = readSettingsJson();

  const hooksSection = (settings['hooks'] as Record<string, unknown>) ?? {};
  const existingHooks: unknown[] = (hooksSection['PostToolUse'] as unknown[]) ?? [];

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
            `frank hook # ${SETTINGS_HOOK_MARKER}`
      )
  );

  if (alreadyPresent) {
    console.log('[frank] settings.json: hook already registered');
    return;
  }

  const newEntry = {
    matcher: HOOK_MATCHER,
    hooks: [HOOK_ENTRY],
  };

  settings['hooks'] = { ...hooksSection, PostToolUse: [...existingHooks, newEntry] };
  writeSettingsJson(settings);
  console.log('[frank] settings.json: hook registered');
}

export function removeSettingsHook(): void {
  const settings = readSettingsJson();
  const hooksSection = (settings['hooks'] as Record<string, unknown>) ?? {};
  const existingHooks = (hooksSection['PostToolUse'] as unknown[]) ?? [];

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
          `frank hook # ${SETTINGS_HOOK_MARKER}`
    );
    return ours.length === 0; // Keep blocks that don't contain our hook
  });

  if (filtered.length === 0) {
    delete hooksSection['PostToolUse'];
  } else {
    hooksSection['PostToolUse'] = filtered;
  }
  if (Object.keys(hooksSection).length === 0) {
    delete settings['hooks'];
  } else {
    settings['hooks'] = hooksSection;
  }

  writeSettingsJson(settings);
  console.log('[frank] settings.json: hook removed');
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
