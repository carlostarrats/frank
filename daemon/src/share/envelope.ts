// Envelope detection for URL share. Implements §1.2 (framework allowlist),
// §1.3 (structural rules), §1.4 (refuse-to-guess) from
// docs/url-share-auto-deploy-design.md.
//
// The detection result is authoritative: if status === 'fail', Share must not
// proceed. Each failure carries an actionable `hint` so the refusal UI can
// tell the user exactly what to do.

import * as fs from 'fs';
import * as path from 'path';
import semver from 'semver';
import type {
  EnvelopeResult,
  EnvelopeFailure,
  DetectedFramework,
  DetectedSdk,
  FrameworkId,
} from './types.js';
import { lookupEncoder, knownPackageNames } from './encoder-registry.js';
import { readEnvShare } from './env-share.js';
import { buildBundle } from './bundler.js';

interface PackageJson {
  name?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
}

/**
 * 100 MB cap on source per §1.3. "Source" here means what the bundler would
 * actually ship — not a naive walk of the whole repo. Measuring against the
 * bundler's allowlist output is the only honest interpretation: anything
 * outside the allowlist isn't going to Vercel, so it can't fail the cap.
 */
const SOURCE_SIZE_CAP = 100 * 1024 * 1024;

// ─── Public API ────────────────────────────────────────────────────────────

export async function checkEnvelope(projectDir: string): Promise<EnvelopeResult> {
  const failures: EnvelopeFailure[] = [];
  const warnings: EnvelopeFailure[] = [];

  const pkg = readPackageJson(projectDir);
  if (!pkg) {
    return {
      status: 'fail',
      projectDir,
      detectedSdks: [],
      failures: [
        {
          code: 'no-package-json',
          message: 'No package.json found at the project root.',
          hint: `Point Frank at the directory containing package.json, or run 'npm init' to create one.`,
        },
      ],
      warnings: [],
    };
  }

  const framework = detectFramework(pkg, projectDir);
  if (!framework) {
    failures.push({
      code: 'framework-unsupported',
      message: `Frank's URL share doesn't support this framework yet.`,
      hint: 'Supported at v1: Next.js 14/15/16, Vite + React/Svelte/Vue, SvelteKit, Astro, Remix.',
      detail: { deps: Object.keys(pkg.dependencies ?? {}).slice(0, 20) },
    });
  }

  // Next.js major-version check (§1.2)
  if (framework && framework.id.startsWith('next-')) {
    const major = parseMajorVersion(framework.versionSpec);
    if (major !== null && ![14, 15, 16].includes(major)) {
      failures.push({
        code: 'next-version-unsupported',
        message: `Next.js ${major}.x isn't in Frank's supported set yet.`,
        hint: 'Supported at v1: Next.js 14, 15, 16.',
        detail: { major, spec: framework.versionSpec },
      });
    }
  }

  failures.push(...checkStructural(pkg, projectDir));

  // Source size = what the bundler would actually ship (§1.1 + §1.3 together).
  // Only meaningful if framework was detected; skip otherwise (the upstream
  // framework-unsupported failure already blocks Share).
  if (framework) {
    const bundle = await buildBundle(projectDir, { framework: framework.id });
    if (bundle.totalSize > SOURCE_SIZE_CAP) {
      failures.push({
        code: 'source-too-large',
        message: `Bundle would be ${formatBytes(bundle.totalSize)}, over the 100 MB cap.`,
        hint: 'Large assets in public/ or framework source dirs are the usual cause. Move heavy media to a CDN or trim before Share.',
        detail: { bytes: bundle.totalSize, cap: SOURCE_SIZE_CAP },
      });
    }
    // Propagate any bundler-level failures (per-file size caps, etc.) that
    // aren't already duplicated above.
    for (const f of bundle.failures) {
      if (!failures.some((existing) => existing.code === f.code)) {
        failures.push(f);
      }
    }
  }

  // §1.4 refuse-to-guess
  const envShare = await readEnvShare(projectDir);
  const envShareKeys = new Set(Object.keys(envShare));
  const detectedSdks = detectSdks(pkg, envShareKeys);
  failures.push(...checkRefuseToGuess(detectedSdks));

  // Encoder-version-range warning (§3.4)
  for (const sdk of detectedSdks) {
    if (sdk.hasEncoder && sdk.encoderValidatedVersions) {
      // Light sanity: if the user's spec doesn't textually contain any major
      // version from the validated range, surface a warning. Step 4 can wire
      // a real semver comparison; for now the heuristic is enough to flag
      // drift loudly.
      if (!specsLikelyOverlap(sdk.installedVersionSpec, sdk.encoderValidatedVersions)) {
        warnings.push({
          code: 'sdk-missing-encoder-and-env-share',
          message: `${sdk.packageName} ${sdk.installedVersionSpec} is outside Frank's validated range ${sdk.encoderValidatedVersions}.`,
          hint: `The generated dummy may not work with this version. Supply a known-working value in .env.share, or proceed and check the smoke test result.`,
          detail: {
            packageName: sdk.packageName,
            installed: sdk.installedVersionSpec,
            validated: sdk.encoderValidatedVersions,
          },
        });
      }
    }
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    projectDir,
    framework: framework ?? undefined,
    detectedSdks,
    failures,
    warnings,
  };
}

// ─── package.json IO ───────────────────────────────────────────────────────

function readPackageJson(projectDir: string): PackageJson | null {
  const p = path.join(projectDir, 'package.json');
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

// ─── Framework detection (§1.2) ────────────────────────────────────────────

function detectFramework(pkg: PackageJson, projectDir: string): DetectedFramework | null {
  const deps = allDeps(pkg);

  if (deps['@sveltejs/kit']) {
    return { id: 'sveltekit', versionSpec: deps['@sveltejs/kit']! };
  }
  if (deps['astro']) {
    return { id: 'astro', versionSpec: deps['astro']! };
  }
  if (deps['@remix-run/react'] || deps['@remix-run/dev']) {
    return {
      id: 'remix',
      versionSpec: deps['@remix-run/react'] ?? deps['@remix-run/dev']!,
    };
  }
  if (deps['next']) {
    const hasApp = fs.existsSync(path.join(projectDir, 'app'));
    const hasPages = fs.existsSync(path.join(projectDir, 'pages'));
    const srcApp = fs.existsSync(path.join(projectDir, 'src', 'app'));
    const srcPages = fs.existsSync(path.join(projectDir, 'src', 'pages'));
    const appPresent = hasApp || srcApp;
    const pagesPresent = hasPages || srcPages;
    let id: FrameworkId = 'next-app';
    if (appPresent && pagesPresent) id = 'next-hybrid';
    else if (pagesPresent && !appPresent) id = 'next-pages';
    return { id, versionSpec: deps['next']! };
  }
  if (deps['vite']) {
    // Vite as a base; pick the UI framework. Svelte beats React/Vue only if
    // @sveltejs/kit is absent (SvelteKit was caught above).
    if (deps['react'] || deps['@vitejs/plugin-react'] || deps['@vitejs/plugin-react-swc']) {
      return { id: 'vite-react', versionSpec: deps['vite']! };
    }
    if (deps['svelte']) {
      return { id: 'vite-svelte', versionSpec: deps['vite']! };
    }
    if (deps['vue']) {
      return { id: 'vite-vue', versionSpec: deps['vite']! };
    }
  }
  return null;
}

// ─── Structural rules (§1.3) ───────────────────────────────────────────────

function checkStructural(pkg: PackageJson, projectDir: string): EnvelopeFailure[] {
  const failures: EnvelopeFailure[] = [];

  // Monorepo root markers
  const monorepoFiles = ['pnpm-workspace.yaml', 'lerna.json', 'turbo.json'];
  for (const f of monorepoFiles) {
    if (fs.existsSync(path.join(projectDir, f))) {
      failures.push({
        code: 'monorepo-root',
        message: `${f} found — Frank doesn't share monorepo roots at v1.`,
        hint: `Point Frank at an individual package directory (e.g., packages/web/). Note that v1 still won't build packages that use workspace:* deps; full monorepo support is v1.1.`,
        detail: { marker: f },
      });
    }
  }
  if (pkg.workspaces) {
    failures.push({
      code: 'monorepo-root',
      message: `package.json declares "workspaces" — Frank doesn't share monorepo roots at v1.`,
      hint: 'Point Frank at an individual workspace package directory.',
    });
  }

  // Workspace / private-protocol deps
  const badProtocols: Array<[RegExp, EnvelopeFailure['code'], string]> = [
    [/^workspace:/, 'workspace-protocol-dep', 'workspace:'],
    [/^file:/, 'workspace-protocol-dep', 'file:'],
    [/^git\+/, 'git-protocol-dep', 'git+'],
    [/^ssh:/, 'git-protocol-dep', 'ssh:'],
  ];
  for (const [name, spec] of Object.entries(allDeps(pkg))) {
    for (const [re, code, label] of badProtocols) {
      if (re.test(spec)) {
        failures.push({
          code,
          message: `${name}@${spec} uses ${label} — Frank's bundler can't ship deps from non-public-npm sources at v1.`,
          hint: `Replace with a public-npm published version, or defer Share until v1.1 (which will support workspace resolution).`,
          detail: { packageName: name, spec },
        });
        break;
      }
    }
  }

  // build script required
  if (!pkg.scripts?.build) {
    failures.push({
      code: 'no-build-script',
      message: `package.json has no "build" script.`,
      hint: `Add one to scripts: "build": "<your framework's build command>".`,
    });
  }

  // engines.node
  const nodeSpec = pkg.engines?.node;
  if (!nodeSpec) {
    failures.push({
      code: 'no-engines-node',
      message: `package.json is missing engines.node.`,
      hint: `Add { "engines": { "node": ">=20.0.0" } } to package.json so Vercel builds against a supported Node version.`,
    });
  } else if (!isEnginesNodeCompatible(nodeSpec)) {
    failures.push({
      code: 'engines-node-unsupported',
      message: `engines.node="${nodeSpec}" doesn't overlap Vercel's supported range (20.x, 22.x).`,
      hint: `Change engines.node to ">=20.0.0" or similar.`,
      detail: { spec: nodeSpec },
    });
  }

  // Private npm registry in .npmrc
  const npmrc = path.join(projectDir, '.npmrc');
  if (fs.existsSync(npmrc)) {
    try {
      const contents = fs.readFileSync(npmrc, 'utf-8');
      for (const line of contents.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // @scope:registry=https://internal.example.com OR registry=https://…
        // Anything that isn't registry.npmjs.org is treated as private.
        const match = trimmed.match(/registry\s*=\s*(\S+)/);
        if (match && !match[1].includes('registry.npmjs.org')) {
          failures.push({
            code: 'private-registry-dep',
            message: `.npmrc configures a non-npmjs registry (${match[1]}).`,
            hint: `Frank's bundler only ships against public npm at v1. Either remove the private registry line before Share, or defer.`,
            detail: { line: trimmed },
          });
          break;
        }
      }
    } catch {
      // non-fatal
    }
  }

  return failures;
}

// ─── SDK detection + refuse-to-guess (§1.4) ───────────────────────────────

function detectSdks(pkg: PackageJson, envShareKeys: Set<string>): DetectedSdk[] {
  const deps = allDeps(pkg);
  const known = knownPackageNames();
  const result: DetectedSdk[] = [];
  for (const packageName of known) {
    if (!(packageName in deps)) continue;
    const encoder = lookupEncoder(packageName);
    const requiredEnvKeys = encoder?.envKeys ?? [];
    const hasEncoder = !!encoder?.generate;
    const hasEnvShareOverride =
      requiredEnvKeys.length > 0 &&
      requiredEnvKeys.every((k) => envShareKeys.has(k));
    result.push({
      packageName,
      installedVersionSpec: deps[packageName]!,
      hasEncoder,
      encoderValidatedVersions: encoder?.validatedVersions,
      hasEnvShareOverride,
      requiredEnvKeys,
    });
  }
  return result;
}

function checkRefuseToGuess(sdks: DetectedSdk[]): EnvelopeFailure[] {
  const failures: EnvelopeFailure[] = [];
  for (const sdk of sdks) {
    if (sdk.hasEncoder) continue;
    if (sdk.hasEnvShareOverride) continue;
    failures.push({
      code: 'sdk-missing-encoder-and-env-share',
      message: `${sdk.packageName} needs env values Frank can't auto-generate yet.`,
      hint: sdk.requiredEnvKeys.length > 0
        ? `Add the following keys to .env.share with safe dummy values: ${sdk.requiredEnvKeys.join(', ')}.`
        : `Add values for this SDK's env keys to .env.share.`,
      detail: {
        packageName: sdk.packageName,
        requiredEnvKeys: sdk.requiredEnvKeys,
      },
    });
  }
  return failures;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function allDeps(pkg: PackageJson): Record<string, string> {
  return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
}

export function parseMajorVersion(spec: string): number | null {
  const match = spec.match(/\d+/);
  return match ? parseInt(match[0], 10) : null;
}

export function isEnginesNodeCompatible(spec: string): boolean {
  // Accept specs that mention an explicit modern major version,
  // or an open-ended lower bound that includes a modern major version.
  if (/\b(1[89]|2\d)\b/.test(spec)) return true;
  if (/>\s*=?\s*(1[4-9]|2\d)/.test(spec)) return true;
  return false;
}

export function specsLikelyOverlap(installed: string, validated: string): boolean {
  // Real semver: ask whether any version matching `installed` also satisfies
  // `validated`. semver doesn't ship a range-intersection helper, so we pick
  // the minimum version of the installed spec and ask if it satisfies the
  // validated range. That's the user-intent reading: "you've said 'I'll ship
  // with at least this version' — is that version what Frank has tested?"
  //
  // Falls back to accept-on-ambiguity so we don't spam warnings on
  // non-semver specs (workspace:*, unknown tags, etc. — those are caught by
  // separate envelope rules already).
  try {
    const min = semver.minVersion(installed);
    if (!min) return true;
    return semver.satisfies(min.version, validated);
  } catch {
    return true;
  }
}

function formatBytes(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
