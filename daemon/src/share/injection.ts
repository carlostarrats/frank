// Overlay injection for URL share. Implements §4.1 + §4.2 + §4.3 from
// docs/url-share-auto-deploy-design.md.
//
// Two halves:
//   1. Layout detection — find the file that carries <html> / <body>.
//      Framework-specific per §4.1. Refuses share on ambiguity instead of
//      silently picking wrong, because mis-injected overlay either double-
//      loads or fails to propagate.
//   2. Injection transform — add exactly one <script> tag to the detected
//      layout on a COPY of the source. User's working tree never touches.
//      Idempotent: re-runs replace the tag rather than stacking.

import * as fs from 'fs';
import * as path from 'path';
import type { FrameworkId } from './types.js';
import { OVERLAY_SCRIPT_CONTENT } from './overlay-source.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface LayoutDetectionResult {
  /** Absolute path to the file that should receive the overlay. */
  path: string;
  /** Relative-to-projectDir path, forward-slashes, for UI display + diffs. */
  relPath: string;
  /** Human-readable framework label for UI + error messages. */
  framework: FrameworkId;
  /** Why this file was chosen (e.g. "contains <html> and <body> tags"). */
  reason: string;
}

export interface LayoutDetectionFailure {
  code:
    | 'layout-not-found'
    | 'layout-missing-html-body'
    | 'pages-document-missing'
    | 'framework-not-handled';
  message: string;
  /** Which paths were considered, for user-visible diagnostics. */
  considered: string[];
}

export interface InjectionOptions {
  shareId: string;
  cloudUrl: string;
}

export interface InjectionResult {
  next: string;
  /**
   * Diff preview: an array of `{ line: number, before, after }` entries for
   * the modified region. UI renders a plain before/after block — the doc §4.3
   * promises transparency, but a full unified-diff library is overkill.
   */
  preview: {
    before: string;
    after: string;
  };
  /** True if the pass modified the input (false means idempotent no-op). */
  changed: boolean;
}

// ─── Layout detection (§4.1) ───────────────────────────────────────────────

/**
 * Locate the root layout file to inject into. Framework-specific rules per
 * the doc. Returns null with a specific failure when detection fails so the
 * refusal UI can show a clear message instead of "share failed somehow."
 */
export function detectLayoutFile(
  projectDir: string,
  framework: FrameworkId,
): LayoutDetectionResult | LayoutDetectionFailure {
  switch (framework) {
    case 'next-app':
    case 'next-hybrid':
      return detectNextAppLayout(projectDir, framework);
    case 'next-pages':
      return detectNextPagesDocument(projectDir);
    case 'sveltekit':
      return detectSveltekitAppHtml(projectDir);
    case 'astro':
      return detectAstroLayout(projectDir);
    case 'remix':
      return detectRemixRoot(projectDir);
    case 'vite-react':
    case 'vite-svelte':
    case 'vite-vue':
      return detectViteIndexHtml(projectDir, framework);
    case 'static-html':
      return detectStaticHtmlIndex(projectDir);
    default:
      return {
        code: 'framework-not-handled',
        message: `Injection not implemented for framework: ${framework}`,
        considered: [],
      };
  }
}

// Next.js App Router — app/layout.* or src/app/layout.*, must contain <html>/<body>.
function detectNextAppLayout(
  projectDir: string,
  framework: FrameworkId,
): LayoutDetectionResult | LayoutDetectionFailure {
  const candidates = [
    'app/layout.tsx',
    'app/layout.jsx',
    'app/layout.ts',
    'app/layout.js',
    'src/app/layout.tsx',
    'src/app/layout.jsx',
    'src/app/layout.ts',
    'src/app/layout.js',
  ];
  const considered: string[] = [];
  for (const rel of candidates) {
    const abs = path.join(projectDir, rel);
    considered.push(rel);
    if (!fs.existsSync(abs)) continue;
    const content = safeRead(abs);
    if (!content) continue;
    if (!containsHtmlAndBody(content)) {
      return {
        code: 'layout-missing-html-body',
        message: `${rel} found but doesn't contain <html> and <body>. Next.js requires the root layout to render both; Frank can't inject into a pass-through.`,
        considered,
      };
    }
    return {
      path: abs,
      relPath: rel,
      framework,
      reason: 'Next.js root layout with <html> and <body>.',
    };
  }
  return {
    code: 'layout-not-found',
    message: `Next.js App Router root layout not found. Looked at: ${candidates.join(', ')}.`,
    considered,
  };
}

// Next.js Pages Router — _document.tsx is the HTML shell.
function detectNextPagesDocument(
  projectDir: string,
): LayoutDetectionResult | LayoutDetectionFailure {
  const candidates = [
    'pages/_document.tsx',
    'pages/_document.jsx',
    'pages/_document.ts',
    'pages/_document.js',
    'src/pages/_document.tsx',
    'src/pages/_document.jsx',
    'src/pages/_document.ts',
    'src/pages/_document.js',
  ];
  const considered: string[] = [];
  for (const rel of candidates) {
    const abs = path.join(projectDir, rel);
    considered.push(rel);
    if (fs.existsSync(abs)) {
      return {
        path: abs,
        relPath: rel,
        framework: 'next-pages',
        reason: 'Next.js Pages Router _document is the HTML shell.',
      };
    }
  }
  // Per §4.1 correction: refuse rather than silently create a _document.tsx.
  return {
    code: 'pages-document-missing',
    message: `Your project is missing pages/_document.tsx. Frank injects the overlay into _document and doesn't create new files. Add a _document following the Next.js docs and try again.`,
    considered,
  };
}

// SvelteKit — src/app.html is the HTML template.
function detectSveltekitAppHtml(
  projectDir: string,
): LayoutDetectionResult | LayoutDetectionFailure {
  const rel = 'src/app.html';
  const abs = path.join(projectDir, rel);
  if (!fs.existsSync(abs)) {
    return {
      code: 'layout-not-found',
      message: 'src/app.html is missing — expected for SvelteKit projects.',
      considered: [rel],
    };
  }
  const content = safeRead(abs) ?? '';
  if (!containsHtmlAndBody(content)) {
    return {
      code: 'layout-missing-html-body',
      message: 'src/app.html exists but does not contain <html> and <body>.',
      considered: [rel],
    };
  }
  return {
    path: abs,
    relPath: rel,
    framework: 'sveltekit',
    reason: 'SvelteKit app.html template contains the HTML shell.',
  };
}

// Astro — first .astro file under src/layouts/ that contains html+body.
function detectAstroLayout(
  projectDir: string,
): LayoutDetectionResult | LayoutDetectionFailure {
  const layoutsDir = path.join(projectDir, 'src', 'layouts');
  const considered: string[] = [];
  if (fs.existsSync(layoutsDir)) {
    const entries = fs.readdirSync(layoutsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.astro')) continue;
      const rel = `src/layouts/${entry.name}`;
      considered.push(rel);
      const abs = path.join(layoutsDir, entry.name);
      const content = safeRead(abs);
      if (content && containsHtmlAndBody(content)) {
        return {
          path: abs,
          relPath: rel,
          framework: 'astro',
          reason: `Astro layout ${entry.name} contains the HTML shell.`,
        };
      }
    }
  }
  return {
    code: 'layout-not-found',
    message: `Astro root layout not found under src/layouts/. Expected at least one .astro file containing <html> and <body>.`,
    considered,
  };
}

// Remix — app/root.tsx is the mandated HTML shell.
function detectRemixRoot(
  projectDir: string,
): LayoutDetectionResult | LayoutDetectionFailure {
  const candidates = ['app/root.tsx', 'app/root.jsx', 'app/root.ts', 'app/root.js'];
  const considered: string[] = [];
  for (const rel of candidates) {
    const abs = path.join(projectDir, rel);
    considered.push(rel);
    if (fs.existsSync(abs)) {
      return {
        path: abs,
        relPath: rel,
        framework: 'remix',
        reason: 'Remix app/root renders the HTML shell.',
      };
    }
  }
  return {
    code: 'layout-not-found',
    message: `Remix app/root not found. Looked at: ${candidates.join(', ')}.`,
    considered,
  };
}

// Vite (React / Svelte / Vue) — index.html is the shell.
function detectViteIndexHtml(
  projectDir: string,
  framework: FrameworkId,
): LayoutDetectionResult | LayoutDetectionFailure {
  const rel = 'index.html';
  const abs = path.join(projectDir, rel);
  const considered = [rel];
  if (!fs.existsSync(abs)) {
    return {
      code: 'layout-not-found',
      message: `index.html not found at project root — Vite apps must have one.`,
      considered,
    };
  }
  return {
    path: abs,
    relPath: rel,
    framework,
    reason: 'Vite index.html is the HTML shell.',
  };
}

// Static HTML — index.html at the root is the single entry point. We don't
// chase sibling .html files at v1: if the reviewer navigates to /about.html
// via a link in the served site, the overlay won't load there. Multi-page
// injection is a follow-up (and rare — most static sites today are either
// single-page or SSG-generated by a framework path).
function detectStaticHtmlIndex(
  projectDir: string,
): LayoutDetectionResult | LayoutDetectionFailure {
  const rel = 'index.html';
  const abs = path.join(projectDir, rel);
  const considered = [rel];
  if (!fs.existsSync(abs)) {
    return {
      code: 'layout-not-found',
      message: `index.html not found at project root.`,
      considered,
    };
  }
  return {
    path: abs,
    relPath: rel,
    framework: 'static-html',
    reason: 'Static site index.html.',
  };
}

// ─── Injection transform (§4.3) ───────────────────────────────────────────

/**
 * The exact tag Frank injects. Same-origin per §4 (served from the deployed
 * app itself at /frank-overlay.js), not from frank-cloud. Connection to
 * frank-cloud is made by the script at runtime via `data-cloud-url`.
 */
const INJECTION_MARKER_ATTR = 'data-frank-share-overlay';

export function renderOverlayScriptTag(opts: InjectionOptions): string {
  const { shareId, cloudUrl } = opts;
  return (
    `<script ${INJECTION_MARKER_ATTR} src="/frank-overlay.js"` +
    ` data-share-id="${escapeAttr(shareId)}"` +
    ` data-cloud-url="${escapeAttr(cloudUrl)}"` +
    ` async></script>`
  );
}

/**
 * Add exactly one overlay script tag to the layout content. Idempotent:
 * if a tag with INJECTION_MARKER_ATTR already exists, replace it in place.
 *
 * Placement rules:
 *   - Prefer inserting immediately before </body> so the tag doesn't block
 *     first paint.
 *   - If </body> isn't found (shouldn't happen on a validated layout),
 *     append to end.
 */
export function injectOverlayScript(content: string, opts: InjectionOptions): InjectionResult {
  const tag = renderOverlayScriptTag(opts);

  // Idempotent replace — match any existing tag with our marker attribute.
  const existingRe = new RegExp(
    `<script\\s+${INJECTION_MARKER_ATTR}[^>]*>\\s*</script>`,
    'i',
  );
  if (existingRe.test(content)) {
    const next = content.replace(existingRe, tag);
    return {
      next,
      changed: next !== content,
      preview: { before: matchToString(content, existingRe), after: tag },
    };
  }

  // Fresh injection: before </body>, else append.
  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(content)) {
    const next = content.replace(bodyClose, `  ${tag}\n$&`);
    return {
      next,
      changed: true,
      preview: { before: '(no previous overlay tag)', after: tag },
    };
  }
  // Fall back to end-of-file (unexpected; layout validator should prevent).
  return {
    next: content + `\n${tag}\n`,
    changed: true,
    preview: { before: '(no </body> — appended to end)', after: tag },
  };
}

// ─── Bundle preparation (§4.1 "copy and modify, never touch working tree") ─

export interface PrepareBundleOptions {
  projectDir: string;
  framework: FrameworkId;
  shareId: string;
  cloudUrl: string;
  /** Which files to copy. Typically produced by share/bundler.ts. */
  files: { relPath: string; absPath: string }[];
  /** Absolute target directory; Frank owns this. */
  workingDir: string;
  /**
   * Content of the frank-overlay.js asset (not a path — the content ships
   * embedded in a TS module). Defaults to the daemon's built-in overlay
   * source when omitted.
   */
  overlaySource?: string;
}

export interface PreparedBundle {
  workingDir: string;
  injectedLayout: {
    relPath: string;
    preview: { before: string; after: string };
  } | null;
  /** Path to the overlay asset as dropped into the working dir. */
  overlayDestPath: string;
}

/**
 * Copy the allowlisted file set into `workingDir`, inject the overlay script
 * into the detected layout, and drop `frank-overlay.js` into public/. Caller
 * is responsible for cleaning up workingDir afterwards.
 *
 * Layout detection is expected to have already succeeded before this is
 * called — if the layout can't be found, we throw loudly rather than ship a
 * silently-broken bundle.
 */
export async function prepareBundle(opts: PrepareBundleOptions): Promise<PreparedBundle> {
  const { framework, shareId, cloudUrl, files, workingDir } = opts;
  const overlaySource = opts.overlaySource ?? OVERLAY_SCRIPT_CONTENT;

  // Fresh workingDir
  await fs.promises.rm(workingDir, { recursive: true, force: true });
  await fs.promises.mkdir(workingDir, { recursive: true });

  // Copy allowlisted files
  for (const f of files) {
    const destAbs = path.join(workingDir, f.relPath);
    await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
    await fs.promises.copyFile(f.absPath, destAbs);
  }

  // Write overlay source where the deployed app will serve it at
  // /frank-overlay.js. Framework-specific: Next/Vite/Astro/Remix serve
  // public/ at the root; SvelteKit uses static/; static-html deploys the
  // project root verbatim so the overlay lives at the root too.
  const overlayRelPath =
    framework === 'sveltekit' ? 'static/frank-overlay.js'
    : framework === 'static-html' ? 'frank-overlay.js'
    : 'public/frank-overlay.js';
  const overlayDestPath = path.join(workingDir, overlayRelPath);
  await fs.promises.mkdir(path.dirname(overlayDestPath), { recursive: true });
  await fs.promises.writeFile(overlayDestPath, overlaySource, 'utf-8');

  // Detect layout IN THE COPY (so relative paths match what's shipping)
  const layout = detectLayoutFile(workingDir, framework);
  if ('code' in layout) {
    throw new Error(`Layout detection failed in working copy: ${layout.message}`);
  }

  // Read, inject, write back
  const original = await fs.promises.readFile(layout.path, 'utf-8');
  const { next, preview, changed } = injectOverlayScript(original, { shareId, cloudUrl });
  if (changed) {
    await fs.promises.writeFile(layout.path, next, 'utf-8');
  }

  return {
    workingDir,
    injectedLayout: changed
      ? { relPath: layout.relPath, preview }
      : { relPath: layout.relPath, preview: { before: '(already injected)', after: '(already injected)' } },
    overlayDestPath,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function safeRead(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function containsHtmlAndBody(content: string): boolean {
  return /<html\b[^>]*>/i.test(content) && /<body\b[^>]*>/i.test(content);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function matchToString(content: string, re: RegExp): string {
  const m = content.match(re);
  return m ? m[0] : '';
}
