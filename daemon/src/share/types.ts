// Shared types for the URL share auto-deploy flow. See
// docs/url-share-auto-deploy-design.md for the design this implements.
//
// Step 2 deliverable: envelope detection + allowlist bundler + refusal UI.
// Step 4 populates the encoder registry. Step 6 wires the Vercel API.

export type FrameworkId =
  | 'next-app'      // Next.js App Router (has app/)
  | 'next-pages'    // Next.js Pages Router (has pages/ but no app/)
  | 'next-hybrid'   // Both app/ and pages/
  | 'vite-react'
  | 'vite-svelte'
  | 'vite-vue'
  | 'sveltekit'
  | 'astro'
  | 'remix';

export interface DetectedFramework {
  id: FrameworkId;
  /** Raw version spec from package.json (e.g. "^16.0.7"). */
  versionSpec: string;
}

export interface DetectedSdk {
  packageName: string;
  /** Version range from package.json (e.g. "^7.2.2"). */
  installedVersionSpec: string;
  /** True when the encoder registry has a validated encoder for this SDK. */
  hasEncoder: boolean;
  /** Semver range the encoder was validated against, when hasEncoder. */
  encoderValidatedVersions?: string;
  /** True when .env.share supplies all env keys this SDK needs. */
  hasEnvShareOverride: boolean;
  /** Env keys the SDK requires (from its registry entry). */
  requiredEnvKeys: string[];
}

export type EnvelopeFailureCode =
  // structural / framework
  | 'no-package-json'
  | 'framework-unsupported'
  | 'next-version-unsupported'
  | 'monorepo-root'
  | 'workspace-protocol-dep'
  | 'no-build-script'
  | 'no-engines-node'
  | 'engines-node-unsupported'
  | 'private-registry-dep'
  | 'git-protocol-dep'
  | 'source-too-large'
  // refuse-to-guess (§1.4)
  | 'sdk-missing-encoder-and-env-share';

export interface EnvelopeFailure {
  code: EnvelopeFailureCode;
  /** One-line user-facing summary. */
  message: string;
  /** Actionable next step. */
  hint?: string;
  /** Structured context (package name, size, etc.). */
  detail?: Record<string, unknown>;
}

export interface EnvelopeResult {
  status: 'pass' | 'fail';
  projectDir: string;
  framework?: DetectedFramework;
  detectedSdks: DetectedSdk[];
  failures: EnvelopeFailure[];
  /** Informational warnings (not failures). E.g. SDK version outside validated range. */
  warnings: EnvelopeFailure[];
}

// ─── Bundler types ─────────────────────────────────────────────────────────

export interface BundleFile {
  /** Path relative to the project root, using forward slashes. */
  relPath: string;
  /** Absolute path on disk. */
  absPath: string;
  /** File size in bytes. */
  size: number;
}

export interface BundleRejection {
  relPath: string;
  /** Why the file was refused. */
  reason:
    | 'env-file-forbidden'
    | 'secret-extension'
    | 'denylist-dir'
    | 'over-size-cap'
    | 'not-in-allowlist';
  /** Bytes if relevant (oversize files). */
  size?: number;
}

export interface BundleResult {
  status: 'ok' | 'fail';
  projectDir: string;
  files: BundleFile[];
  rejected: BundleRejection[];
  /** Total bundle size in bytes. */
  totalSize: number;
  /** Reasons the bundle couldn't be produced (e.g. total size cap exceeded). */
  failures: EnvelopeFailure[];
}
