// Allowlist bundler for URL share. Implements §1.1 from
// docs/url-share-auto-deploy-design.md.
//
// Positive list of what ships to Vercel: framework source dirs, package.json,
// one lockfile, public/, known configs, middleware/proxy/instrumentation,
// and exactly one env file (.env.share). Everything else is refused,
// hardcoded — including explicit user request to ship .env.local.
//
// This module produces the file list + rejection list. Archiving for upload
// happens in step 6 per §9.

import * as fs from 'fs';
import * as path from 'path';
import type {
  BundleResult,
  BundleFile,
  BundleRejection,
  EnvelopeFailure,
  FrameworkId,
} from './types.js';

/** Per-file cap from §1.1. */
const FILE_SIZE_CAP = 50 * 1024 * 1024;
/** Aligns with the source cap from §1.3. */
const TOTAL_SIZE_CAP = 100 * 1024 * 1024;

const DENYLIST_DIRS = new Set([
  '.git',
  'node_modules',
  '.next',
  '.turbo',
  '.svelte-kit',
  '.astro',
  'dist',
  'build',
  'out',
  '.vercel',
  'test-results',
  'playwright-report',
  'coverage',
  '.cache',
]);

/** Secret-extension files outside public/. */
const SECRET_EXT_PATTERN = /\.(pem|key|p12|jks|crt)$/i;
const ID_RSA_PATTERN = /(?:^|\/)id_rsa/i;

/** Any .env.* except exactly .env.share is refused. */
const ENV_FILE_PATTERN = /^\.env(?:\..+)?$/;

const ALLOWED_LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
]);

const ALLOWED_ROOT_FILE_PATTERNS: RegExp[] = [
  /^package\.json$/,
  /^next\.config\.(?:js|ts|mjs|cjs)$/,
  /^vite\.config\.(?:js|ts|mjs|cjs)$/,
  /^svelte\.config\.(?:js|ts|mjs|cjs)$/,
  /^astro\.config\.(?:js|ts|mjs|cjs)$/,
  /^remix\.config\.(?:js|ts|mjs|cjs)$/,
  /^tsconfig\.json$/,
  /^tsconfig\..+\.json$/,
  /^postcss\.config\.(?:js|ts|mjs|cjs)$/,
  /^tailwind\.config\.(?:js|ts|mjs|cjs)$/,
  /^eslint\.config\.(?:js|ts|mjs|cjs)$/,
  /^components\.json$/,
  /^index\.html$/,         // Vite entry HTML
  /^middleware\.(?:js|ts|mjs|cjs)$/,
  /^proxy\.(?:js|ts|mjs|cjs)$/,                  // Next.js 16+
  /^instrumentation\.(?:js|ts|mjs|cjs)$/,
  /^instrumentation-client\.(?:js|ts|mjs|cjs)$/,
  /^sentry\.[^/]+\.config\.(?:js|ts|mjs|cjs)$/,
  /^\.nvmrc$/,
  /^\.node-version$/,
  /^vercel\.json$/,
];

const FRAMEWORK_SOURCE_DIRS: Record<FrameworkId, string[]> = {
  'next-app': ['app', 'pages', 'src', 'components', 'lib', 'hooks', 'contexts', 'utils', 'styles'],
  'next-pages': ['pages', 'src', 'components', 'lib', 'hooks', 'contexts', 'utils', 'styles'],
  'next-hybrid': ['app', 'pages', 'src', 'components', 'lib', 'hooks', 'contexts', 'utils', 'styles'],
  'vite-react': ['src'],
  'vite-svelte': ['src'],
  'vite-vue': ['src'],
  'sveltekit': ['src', 'static'],
  'astro': ['src'],
  'remix': ['app'],
  // Static HTML uses a different (denylist) bundler path — this entry is
  // a placeholder so the type's exhaustiveness stays happy.
  'static-html': [],
};

/** public/ ships for all frameworks. */
const COMMON_SOURCE_DIRS = ['public'];

export interface BundleOptions {
  framework: FrameworkId;
}

export async function buildBundle(
  projectDir: string,
  opts: BundleOptions,
): Promise<BundleResult> {
  // Static HTML takes a denylist path — see buildStaticHtmlBundle for why.
  if (opts.framework === 'static-html') {
    return buildStaticHtmlBundle(projectDir);
  }

  const allowedDirs = new Set([
    ...FRAMEWORK_SOURCE_DIRS[opts.framework],
    ...COMMON_SOURCE_DIRS,
  ]);

  const files: BundleFile[] = [];
  const rejected: BundleRejection[] = [];
  const failures: EnvelopeFailure[] = [];
  let totalSize = 0;

  // Root-level files
  let rootEntries: fs.Dirent[];
  try {
    rootEntries = await fs.promises.readdir(projectDir, { withFileTypes: true });
  } catch (err) {
    return {
      status: 'fail',
      projectDir,
      files: [],
      rejected: [],
      totalSize: 0,
      failures: [
        {
          code: 'no-package-json',
          message: `Can't read project directory: ${(err as Error).message}`,
        },
      ],
    };
  }

  // Track lockfile once — §1.1 says exactly one.
  let lockfileSeen: string | null = null;

  for (const entry of rootEntries) {
    const relPath = entry.name;
    const absPath = path.join(projectDir, entry.name);

    if (entry.isDirectory()) {
      if (DENYLIST_DIRS.has(entry.name)) {
        rejected.push({ relPath, reason: 'denylist-dir' });
        continue;
      }
      if (!allowedDirs.has(entry.name)) {
        rejected.push({ relPath, reason: 'not-in-allowlist' });
        continue;
      }
      // Recurse
      const walked = await walkDirectory(absPath, relPath);
      for (const w of walked.files) {
        if (w.size > FILE_SIZE_CAP) {
          rejected.push({
            relPath: w.relPath,
            reason: 'over-size-cap',
            size: w.size,
          });
          continue;
        }
        files.push(w);
        totalSize += w.size;
      }
      rejected.push(...walked.rejected);
      continue;
    }

    if (!entry.isFile()) continue;

    // .env.* — only .env.share allowed
    if (ENV_FILE_PATTERN.test(entry.name)) {
      if (entry.name === '.env.share') {
        // fall through to size check + admit
      } else {
        rejected.push({ relPath, reason: 'env-file-forbidden' });
        continue;
      }
    }

    // Secret-extension denylist (top level)
    if (SECRET_EXT_PATTERN.test(entry.name) || ID_RSA_PATTERN.test(entry.name)) {
      rejected.push({ relPath, reason: 'secret-extension' });
      continue;
    }

    // Lockfile — exactly one
    if (ALLOWED_LOCKFILES.has(entry.name)) {
      if (lockfileSeen) {
        rejected.push({
          relPath,
          reason: 'not-in-allowlist',
        });
        continue;
      }
      lockfileSeen = entry.name;
      // fall through to admit
    } else if (entry.name === '.env.share') {
      // explicit allow
    } else if (!ALLOWED_ROOT_FILE_PATTERNS.some((re) => re.test(entry.name))) {
      rejected.push({ relPath, reason: 'not-in-allowlist' });
      continue;
    }

    // Size + admit
    let size: number;
    try {
      const stat = await fs.promises.stat(absPath);
      size = stat.size;
    } catch {
      continue;
    }
    if (size > FILE_SIZE_CAP) {
      rejected.push({ relPath, reason: 'over-size-cap', size });
      continue;
    }
    files.push({ relPath, absPath, size });
    totalSize += size;
  }

  if (totalSize > TOTAL_SIZE_CAP) {
    failures.push({
      code: 'source-too-large',
      message: `Bundle total is ${formatBytes(totalSize)}, over the 100 MB cap.`,
      hint: `Large assets in public/ or source dirs are the usual cause. Move heavy media to a CDN or trim before Share.`,
      detail: { bytes: totalSize, cap: TOTAL_SIZE_CAP },
    });
  }

  return {
    status: failures.length === 0 ? 'ok' : 'fail',
    projectDir,
    files,
    rejected,
    totalSize,
    failures,
  };
}

// ─── Directory walk ───────────────────────────────────────────────────────

interface WalkResult {
  files: BundleFile[];
  rejected: BundleRejection[];
}

async function walkDirectory(absDir: string, relDir: string): Promise<WalkResult> {
  const files: BundleFile[] = [];
  const rejected: BundleRejection[] = [];

  async function recurse(currentAbs: string, currentRel: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childAbs = path.join(currentAbs, entry.name);
      // Relative paths use forward slashes for portability
      const childRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (DENYLIST_DIRS.has(entry.name)) {
          rejected.push({ relPath: childRel, reason: 'denylist-dir' });
          continue;
        }
        await recurse(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;

      // Env files anywhere below root (not just at root) — refuse unless .env.share
      if (ENV_FILE_PATTERN.test(entry.name) && entry.name !== '.env.share') {
        rejected.push({ relPath: childRel, reason: 'env-file-forbidden' });
        continue;
      }

      // Secret-extensions outside public/ are refused
      if (!childRel.startsWith('public/') && (SECRET_EXT_PATTERN.test(entry.name) || ID_RSA_PATTERN.test(entry.name))) {
        rejected.push({ relPath: childRel, reason: 'secret-extension' });
        continue;
      }

      let size: number;
      try {
        const stat = await fs.promises.stat(childAbs);
        size = stat.size;
      } catch {
        continue;
      }
      files.push({ relPath: childRel, absPath: childAbs, size });
    }
  }

  await recurse(absDir, relDir);
  return { files, rejected };
}

// ─── Static-HTML bundler (denylist) ───────────────────────────────────────
//
// Framework projects use an allowlist because a forgotten .env.staging ships
// real credentials to a public Vercel URL — the cost of "fail open" is too
// high. Static HTML sites don't have that failure mode: there's no server
// reading env files, no module-scope SDK init, no .env.local pattern. A
// static site is content files — refusing content you forgot to list is
// the exact "fail closed makes the tool annoying" problem. So: same denylist
// (env files, .git, node_modules, secret extensions, secret-ish filenames),
// allow everything else.

/** Filenames that hint at secrets even without a recognized extension. */
const SECRET_NAME_PATTERN = /(?:^|[-_./])(?:secret|credential|private)(?:s?)(?:[-_./]|$)/i;

async function buildStaticHtmlBundle(projectDir: string): Promise<BundleResult> {
  const files: BundleFile[] = [];
  const rejected: BundleRejection[] = [];
  const failures: EnvelopeFailure[] = [];
  let totalSize = 0;

  async function recurse(absDir: string, relDir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const childAbs = path.join(absDir, entry.name);

      if (entry.isDirectory()) {
        if (DENYLIST_DIRS.has(entry.name)) {
          rejected.push({ relPath: childRel, reason: 'denylist-dir' });
          continue;
        }
        await recurse(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;

      // Same env-file refusal as the framework bundler. .env.share is the
      // one exception for framework projects; static sites have no reason
      // to ship any .env file so refuse them all.
      if (ENV_FILE_PATTERN.test(entry.name)) {
        rejected.push({ relPath: childRel, reason: 'env-file-forbidden' });
        continue;
      }
      if (SECRET_EXT_PATTERN.test(entry.name) || ID_RSA_PATTERN.test(entry.name)) {
        rejected.push({ relPath: childRel, reason: 'secret-extension' });
        continue;
      }
      // Secret-ish filenames ship with a warning rather than a flat refusal —
      // users name real files "secrets.css" all the time (rare but not
      // impossible). Right call is to ship + surface so the human can
      // veto if needed. v1: refuse to stay safe-by-default.
      if (SECRET_NAME_PATTERN.test(entry.name)) {
        rejected.push({ relPath: childRel, reason: 'secret-extension' });
        continue;
      }

      let size: number;
      try {
        const stat = await fs.promises.stat(childAbs);
        size = stat.size;
      } catch {
        continue;
      }
      if (size > FILE_SIZE_CAP) {
        rejected.push({ relPath: childRel, reason: 'over-size-cap', size });
        failures.push({
          code: 'source-too-large',
          message: `${childRel} is ${formatBytes(size)}, over the 50 MB per-file cap.`,
          hint: `Move heavy media to a CDN or trim the file before Share.`,
          detail: { relPath: childRel, size },
        });
        continue;
      }
      files.push({ relPath: childRel, absPath: childAbs, size });
      totalSize += size;
    }
  }

  await recurse(projectDir, '');

  return {
    status: failures.length > 0 ? 'fail' : 'ok',
    projectDir,
    files,
    rejected,
    totalSize,
    failures,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
