// End-to-end share creation orchestration. Combines envelope detection,
// preflight build/smoke, bundle preparation, and Vercel deployment into one
// flow. Returns a structured result the UI can render directly.
//
// Step 8 (revoke contract) and step 7 (cloud-side share record) remain
// independent; this module just owns the "user clicks Share → preview URL
// comes back" path.

import * as crypto from 'crypto';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { FrameworkId, EnvelopeResult } from './types.js';
import { checkEnvelope } from './envelope.js';
import { buildBundle } from './bundler.js';
import { runPreflight, type PreflightResult } from './preflight.js';
import { prepareBundle } from './injection.js';
import { generateEncoderEnv } from './encoder-registry.js';
import { readEnvShare } from './env-share.js';
import {
  createDeployment,
  pollDeployment,
  deleteDeployment,
  disableDeploymentProtection,
  streamBuildLogs,
  type CreateDeploymentResult,
  type PollDeploymentResult,
  type BuildZone,
} from './vercel-api.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface ShareCreateOptions {
  projectDir: string;
  vercelToken: string;
  vercelTeamId?: string;
  /** Frank-cloud base URL the overlay will reach back to. */
  cloudUrl: string;
  /** Project name passed to Vercel; shortened from shareId if absent. */
  projectName?: string;
  /** Skip preflight smoke (useful in tests; not recommended in prod). */
  skipPreflight?: boolean;
  /** Progress callback for long-running stages. */
  onProgress?: (info: ShareProgress) => void;
}

export interface ShareProgress {
  stage:
    | 'envelope'
    | 'preflight-build'
    | 'preflight-smoke'
    | 'bundle-prep'
    | 'vercel-upload'
    | 'vercel-building'
    | 'vercel-log'        // one streamed line from Vercel's /events endpoint
    | 'complete';
  /** Human-readable status for UI. */
  message: string;
  /** Optional fields for the build-zone UX. */
  elapsedMs?: number;
  zone?: BuildZone;
  readyState?: string;
  /** For `vercel-log` stage: the log event type + raw text. */
  logType?: string;
  logText?: string;
}

export interface ShareCreateResult {
  status: 'ok' | 'fail';
  shareId: string;
  projectDir: string;
  envelope: EnvelopeResult;
  preflight: PreflightResult | null;
  deployment: (CreateDeploymentResult & PollDeploymentResult) | null;
  /** Preview URL when everything succeeded. */
  deploymentUrl: string | null;
  /** Cleaned-up bundle working dir path (exists only until end of call). */
  workingDir: string | null;
  /** Reason for failure — references the stage and a user-facing message. */
  failure?: { stage: ShareProgress['stage']; message: string };
}

// ─── Public entry ─────────────────────────────────────────────────────────

export async function createShare(opts: ShareCreateOptions): Promise<ShareCreateResult> {
  const shareId = generateShareId();
  const report = (stage: ShareProgress['stage'], message: string, extra: Partial<ShareProgress> = {}): void => {
    opts.onProgress?.({ stage, message, ...extra });
  };

  // ── Stage 1: envelope ────────────────────────────────────────────────
  report('envelope', 'Checking share envelope…');
  const envelope = await checkEnvelope(opts.projectDir);
  if (envelope.status === 'fail' || !envelope.framework) {
    return {
      status: 'fail',
      shareId,
      projectDir: opts.projectDir,
      envelope,
      preflight: null,
      deployment: null,
      deploymentUrl: null,
      workingDir: null,
      failure: {
        stage: 'envelope',
        message: envelope.failures[0]?.message ?? 'Envelope check failed.',
      },
    };
  }
  const framework: FrameworkId = envelope.framework.id;

  // ── Stage 2: env resolution + preflight ──────────────────────────────
  const envShare = await readEnvShare(opts.projectDir);
  const encoderEnv = generateEncoderEnv(envelope.detectedSdks.map((s) => s.packageName));
  const mergedEnv: Record<string, string> = {
    ...encoderEnv,
    ...envShare,
    NEXT_PUBLIC_FRANK_SHARE: '1',
  };

  let preflight: PreflightResult | null = null;
  if (!opts.skipPreflight) {
    report('preflight-build', 'Running pre-flight build…');
    preflight = await runPreflight({
      projectDir: opts.projectDir,
      framework,
      env: mergedEnv,
    });
    if (preflight.build.status === 'fail') {
      return {
        status: 'fail',
        shareId,
        projectDir: opts.projectDir,
        envelope,
        preflight,
        deployment: null,
        deploymentUrl: null,
        workingDir: null,
        failure: {
          stage: 'preflight-build',
          message: `Pre-flight build failed with exit ${preflight.build.exitCode}. Fix build errors locally before Share.`,
        },
      };
    }
    if (preflight.smoke?.readiness === 'red') {
      return {
        status: 'fail',
        shareId,
        projectDir: opts.projectDir,
        envelope,
        preflight,
        deployment: null,
        deploymentUrl: null,
        workingDir: null,
        failure: {
          stage: 'preflight-smoke',
          message: `Pre-flight smoke failed (🔴). ${preflight.smoke.errorLineCount} error line${preflight.smoke.errorLineCount === 1 ? '' : 's'} in 30s tail — app is crashing or retrying hot.`,
        },
      };
    }
  }

  // ── Stage 3: bundle prep ─────────────────────────────────────────────
  report('bundle-prep', 'Preparing share bundle + injecting overlay…');
  const bundle = await buildBundle(opts.projectDir, { framework });
  if (bundle.status !== 'ok') {
    return {
      status: 'fail',
      shareId,
      projectDir: opts.projectDir,
      envelope,
      preflight,
      deployment: null,
      deploymentUrl: null,
      workingDir: null,
      failure: {
        stage: 'bundle-prep',
        message: bundle.failures[0]?.message ?? 'Bundle preparation failed.',
      },
    };
  }

  const workingDir = path.join(os.homedir(), '.frank', 'share-builds', shareId);
  let prepared;
  try {
    prepared = await prepareBundle({
      projectDir: opts.projectDir,
      framework,
      shareId,
      cloudUrl: opts.cloudUrl,
      files: bundle.files.map((f) => ({ relPath: f.relPath, absPath: f.absPath })),
      workingDir,
    });
  } catch (err) {
    return {
      status: 'fail',
      shareId,
      projectDir: opts.projectDir,
      envelope,
      preflight,
      deployment: null,
      deploymentUrl: null,
      workingDir,
      failure: { stage: 'bundle-prep', message: (err as Error).message },
    };
  }

  // ── Stage 4: Vercel deploy ───────────────────────────────────────────
  report('vercel-upload', 'Uploading bundle to Vercel…');

  // Re-enumerate files under the prepared workingDir (includes the overlay
  // asset + the modified layout). We build this list by walking the dir.
  const deployFiles: { relPath: string; absPath: string }[] = [];
  await walkDir(prepared.workingDir, prepared.workingDir, deployFiles);

  const projectName = opts.projectName ?? `frank-share-${shareId.slice(0, 8)}`;
  let created: CreateDeploymentResult;
  try {
    created = await createDeployment({
      token: opts.vercelToken,
      teamId: opts.vercelTeamId,
      projectName,
      framework,
      files: deployFiles,
      env: mergedEnv,
      target: 'preview',
    });
  } catch (err) {
    return {
      status: 'fail',
      shareId,
      projectDir: opts.projectDir,
      envelope,
      preflight,
      deployment: null,
      deploymentUrl: null,
      workingDir: prepared.workingDir,
      failure: { stage: 'vercel-upload', message: (err as Error).message },
    };
  }

  // Disable Vercel Authentication + Password Protection on the newly-created
  // project so reviewers can open the share link without a Vercel login.
  // Best-effort: if it fails, the deployment still works — the user just
  // needs to flip protection off manually in the Vercel dashboard. We report
  // the state via progress so the UI can surface a hint.
  const protection = await disableDeploymentProtection({
    token: opts.vercelToken,
    teamId: opts.vercelTeamId,
    projectIdOrName: projectName,
  });
  if (!protection.ok) {
    report('vercel-building', `Couldn't auto-disable deployment protection: ${protection.message ?? 'unknown'}. Reviewer may see a Vercel login page — disable protection manually in the Vercel dashboard.`);
  }

  // ── Stage 5: poll until READY ────────────────────────────────────────
  report('vercel-building', 'Vercel building your preview…', { readyState: created.readyState });

  // Stream Vercel's build-log events in parallel with the ready-state poll.
  // The poll loop is authoritative for terminal state; the stream exists
  // purely to surface log lines to the UI. Abort the stream when poll
  // resolves so we don't hold an open fetch after we're done.
  const logAbort = new AbortController();
  const logStream = streamBuildLogs({
    token: opts.vercelToken,
    teamId: opts.vercelTeamId,
    deploymentId: created.id,
    signal: logAbort.signal,
    onLine: (evt) => {
      // Filter to user-facing signal: build stdout/stderr + fatal errors.
      // Skip deployment-state + command noise — the poll loop already
      // surfaces readyState transitions via its own onProgress events.
      if (evt.type !== 'stdout' && evt.type !== 'stderr' && evt.type !== 'fatal') return;
      if (!evt.text) return;
      report('vercel-log', evt.text, { logType: evt.type, logText: evt.text });
    },
  });

  const polled = await pollDeployment({
    token: opts.vercelToken,
    teamId: opts.vercelTeamId,
    deploymentId: created.id,
    onProgress: (info) => {
      report('vercel-building', 'Vercel building your preview…', {
        elapsedMs: info.elapsedMs,
        zone: info.zone,
        readyState: info.readyState,
      });
    },
  });

  // Poll is done — shut down the log stream and wait for it to drain.
  // Swallow errors: draining failure shouldn't fail the share.
  logAbort.abort();
  await logStream.catch(() => {});

  if (polled.readyState !== 'READY') {
    // Clean up workingDir best-effort — Vercel's deployment is in an error
    // state; nothing we can serve.
    await safeCleanup(prepared.workingDir);
    return {
      status: 'fail',
      shareId,
      projectDir: opts.projectDir,
      envelope,
      preflight,
      deployment: { ...created, ...polled },
      deploymentUrl: null,
      workingDir: null,
      failure: {
        stage: 'vercel-building',
        message: polled.error ?? `Deployment ended in state ${polled.readyState}.`,
      },
    };
  }

  // ── Stage 6: done ────────────────────────────────────────────────────
  // Preserve working dir for now — future steps may need it for re-deploys.
  // An explicit cleanup pass can evict old dirs by shareId age.
  report('complete', 'Share live.', { readyState: 'READY' });
  return {
    status: 'ok',
    shareId,
    projectDir: opts.projectDir,
    envelope,
    preflight,
    deployment: { ...created, ...polled },
    deploymentUrl: `https://${polled.url}`,
    workingDir: prepared.workingDir,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function generateShareId(): string {
  return crypto.randomBytes(16).toString('hex');
}

async function walkDir(
  rootAbs: string,
  currentAbs: string,
  out: { relPath: string; absPath: string }[],
): Promise<void> {
  const entries = await fs.promises.readdir(currentAbs, { withFileTypes: true });
  for (const entry of entries) {
    const childAbs = path.join(currentAbs, entry.name);
    if (entry.isDirectory()) {
      await walkDir(rootAbs, childAbs, out);
    } else if (entry.isFile()) {
      const relPath = path.relative(rootAbs, childAbs).split(path.sep).join('/');
      out.push({ relPath, absPath: childAbs });
    }
  }
}

async function safeCleanup(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // non-fatal
  }
}

// ─── Revoke (§8) ───────────────────────────────────────────────────────────

export interface RevokeShareOptions {
  /** Vercel deploy token from Frank config. */
  vercelToken: string;
  /** Vercel team id, if the deployment was created against a team. */
  vercelTeamId?: string;
  /** Vercel deployment id to tear down. */
  vercelDeploymentId: string;
  /**
   * Callback that flips the share's `revoked` flag on frank-cloud. Passed in
   * so this module doesn't take a direct dependency on cloud.ts — keeps
   * share-create testable in isolation.
   */
  flipCloudFlag: () => Promise<{ ok: boolean; error?: string }>;
}

export interface RevokeShareResult {
  /** True when the share link is dead (cloud flag flipped). */
  linkInvalidated: boolean;
  /** True when Vercel confirmed the deployment delete. */
  vercelDeleted: boolean;
  /** User-facing status string matching §7.2's UI model. */
  status: 'complete' | 'vercel-cleanup-failed' | 'cloud-flag-failed';
  cloudError?: string;
  vercelError?: string;
}

/**
 * Two-step revoke per §7 design:
 *   1. Flip the cloud flag synchronously — the share link starts returning
 *      410/404 within milliseconds.
 *   2. Call Vercel DELETE to tear down the auto-deployed preview. On failure
 *      we surface cleanup-failed to the UI; v1 doesn't retry. The retry
 *      queue is a v1-hardening follow-up.
 */
export async function revokeShare(opts: RevokeShareOptions): Promise<RevokeShareResult> {
  // Step 1: flip cloud flag. If this fails, the share link is still live —
  // fail fast and surface.
  const cloud = await opts.flipCloudFlag();
  if (!cloud.ok) {
    return {
      linkInvalidated: false,
      vercelDeleted: false,
      status: 'cloud-flag-failed',
      cloudError: cloud.error ?? 'Cloud flag flip failed',
    };
  }

  // Step 2: tear down Vercel deployment.
  try {
    await deleteDeployment({
      token: opts.vercelToken,
      teamId: opts.vercelTeamId,
      deploymentId: opts.vercelDeploymentId,
    });
    return {
      linkInvalidated: true,
      vercelDeleted: true,
      status: 'complete',
    };
  } catch (err) {
    return {
      linkInvalidated: true,
      vercelDeleted: false,
      status: 'vercel-cleanup-failed',
      vercelError: (err as Error).message,
    };
  }
}
