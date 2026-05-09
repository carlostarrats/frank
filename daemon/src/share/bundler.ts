// Allowlist bundler for URL share. Implements §1.1 from
// docs/url-share-auto-deploy-design.md.
//
// Positive list of what ships to Vercel: framework-specific source dirs,
// framework-specific root files, and exactly one env file (.env.share).
// Everything else is refused, hardcoded — including explicit user request to
// ship .env.local.
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

const NO_ALLOWED_LOCKFILES = new Set<string>();

const JS_ALLOWED_ROOT_FILE_PATTERNS: RegExp[] = [
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

const FRAMEWORK_ALLOWED_ROOT_FILE_PATTERNS: Record<FrameworkId, RegExp[]> = {
  'next-app': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'next-pages': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'next-hybrid': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'vite-react': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'vite-svelte': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'vite-vue': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'sveltekit': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'astro': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'remix': JS_ALLOWED_ROOT_FILE_PATTERNS,
  'fastapi-jinja': [
    /^requirements\.txt$/,
    /^pyproject\.toml$/,
    /^uv\.lock$/,
    /^poetry\.lock$/,
  ],
  'static-html': [],
};

const FRAMEWORK_ALLOWED_LOCKFILES: Record<FrameworkId, ReadonlySet<string>> = {
  'next-app': ALLOWED_LOCKFILES,
  'next-pages': ALLOWED_LOCKFILES,
  'next-hybrid': ALLOWED_LOCKFILES,
  'vite-react': ALLOWED_LOCKFILES,
  'vite-svelte': ALLOWED_LOCKFILES,
  'vite-vue': ALLOWED_LOCKFILES,
  'sveltekit': ALLOWED_LOCKFILES,
  'astro': ALLOWED_LOCKFILES,
  'remix': ALLOWED_LOCKFILES,
  'fastapi-jinja': NO_ALLOWED_LOCKFILES,
  'static-html': NO_ALLOWED_LOCKFILES,
};

const FRAMEWORK_SOURCE_DIRS: Record<FrameworkId, string[]> = {
  'next-app': ['app', 'pages', 'src', 'components', 'lib', 'hooks', 'contexts', 'utils', 'styles', 'public'],
  'next-pages': ['pages', 'src', 'components', 'lib', 'hooks', 'contexts', 'utils', 'styles', 'public'],
  'next-hybrid': ['app', 'pages', 'src', 'components', 'lib', 'hooks', 'contexts', 'utils', 'styles', 'public'],
  'vite-react': ['src', 'public'],
  'vite-svelte': ['src', 'public'],
  'vite-vue': ['src', 'public'],
  'sveltekit': ['src', 'static', 'public'],
  'astro': ['src', 'public'],
  'remix': ['app', 'public'],
  'fastapi-jinja': ['app'],
  // Static HTML uses a different (denylist) bundler path — this entry is
  // a placeholder so the type's exhaustiveness stays happy.
  'static-html': [],
};

// The Python path is intentionally strict: only the LoCA-style FastAPI source
// tree, Jinja templates, and static subtree are shipped.
const FASTAPI_ALLOWED_FILE_PATTERNS: RegExp[] = [
  /^app\/(?:__init__|config|fake_db|main)\.py$/,
  /^app\/api\/.+\.py$/,
  /^app\/models\/.+\.py$/,
  /^app\/services\/.+\.py$/,
  /^app\/web\/(?:__init__|generate|router)\.py$/,
  /^app\/web\/routes\/.+\.py$/,
  /^app\/web\/templates\/.+$/,
  /^app\/web\/static\/.+$/,
];

const FASTAPI_ALLOWED_DIR_PREFIXES = [
  'app',
  'app/api',
  'app/api/routes',
  'app/models',
  'app/services',
  'app/web',
  'app/web/routes',
  'app/web/templates',
  'app/web/static',
];

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

  const allowedDirs = new Set(FRAMEWORK_SOURCE_DIRS[opts.framework]);
  const allowedRootFilePatterns = FRAMEWORK_ALLOWED_ROOT_FILE_PATTERNS[opts.framework];
  const allowedLockfiles = FRAMEWORK_ALLOWED_LOCKFILES[opts.framework];

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
      const walked = opts.framework === 'fastapi-jinja'
        ? await walkFastapiJinjaDirectory(absPath, relPath)
        : await walkDirectory(absPath, relPath);
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
    if (allowedLockfiles.has(entry.name)) {
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
    } else if (!allowedRootFilePatterns.some((re) => re.test(entry.name))) {
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

async function walkFastapiJinjaDirectory(absDir: string, relDir: string): Promise<WalkResult> {
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
      const childRel = currentRel ? `${currentRel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (DENYLIST_DIRS.has(entry.name)) {
          rejected.push({ relPath: childRel, reason: 'denylist-dir' });
          continue;
        }
        const allowedDir = FASTAPI_ALLOWED_DIR_PREFIXES.includes(childRel)
          || childRel.startsWith('app/web/templates/')
          || childRel.startsWith('app/web/static/');
        if (!allowedDir) {
          rejected.push({ relPath: childRel, reason: 'not-in-allowlist' });
          continue;
        }
        await recurse(childAbs, childRel);
        continue;
      }
      if (!entry.isFile()) continue;

      // FastAPI/Jinja keeps the global policy: only the single root
      // .env.share may ship. Nested env files in app/ stay forbidden.
      if (ENV_FILE_PATTERN.test(entry.name)) {
        rejected.push({ relPath: childRel, reason: 'env-file-forbidden' });
        continue;
      }

      if (SECRET_EXT_PATTERN.test(entry.name) || ID_RSA_PATTERN.test(entry.name)) {
        rejected.push({ relPath: childRel, reason: 'secret-extension' });
        continue;
      }

      if (!FASTAPI_ALLOWED_FILE_PATTERNS.some((re) => re.test(childRel))) {
        rejected.push({ relPath: childRel, reason: 'not-in-allowlist' });
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
