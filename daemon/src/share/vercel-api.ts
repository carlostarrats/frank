// Vercel Deployments API client for URL share. Implements §6 from
// docs/url-share-auto-deploy-design.md.
//
// Scope kept narrow: create preview deployment from a file bundle, poll for
// READY, return the preview URL; delete deployment for revoke. Real-time
// build-log streaming via /events is deferred.
//
// Auth uses the user's personal Vercel access token, which is account-scoped
// rather than permission-scoped (see §6.1 honest-disclosure language in the
// design doc).

import * as fs from 'fs';
import * as path from 'path';
import type { FrameworkId } from './types.js';

// ─── Public types ──────────────────────────────────────────────────────────

export interface VercelFile {
  /** Absolute path on disk; contents read at request time. */
  absPath: string;
  /** Path inside the deployment (forward slashes). */
  relPath: string;
}

export interface CreateDeploymentOptions {
  token: string;
  projectName: string;
  framework: FrameworkId;
  files: VercelFile[];
  env?: Record<string, string>;
  target?: 'preview' | 'production';
  teamId?: string;
}

export interface CreateDeploymentResult {
  id: string;
  url: string;          // `<id>.vercel.app`
  readyState: string;   // "QUEUED" | "BUILDING" | "READY" | "ERROR" | "CANCELED"
}

export interface PollDeploymentOptions {
  token: string;
  deploymentId: string;
  teamId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Fires on every poll with the latest readyState and elapsed time. */
  onProgress?: (info: { readyState: string; elapsedMs: number; zone: BuildZone }) => void;
}

export interface PollDeploymentResult {
  id: string;
  url: string;
  readyState: string;
  elapsedMs: number;
  /** Non-null when readyState reaches ERROR — tail of the last error payload. */
  error?: string;
}

export interface DeleteDeploymentOptions {
  token: string;
  deploymentId: string;
  teamId?: string;
}

/** §6.3 three-zone UX: 0-90s expected, 90s-5min degraded, >5min timeout. */
export type BuildZone = 'expected' | 'taking-longer' | 'timeout';

// ─── Constants ─────────────────────────────────────────────────────────────

const VERCEL_API_BASE = 'https://api.vercel.com';
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;
const EXPECTED_ZONE_END_MS = 90 * 1000;

/** Framework IDs → Vercel framework slugs. */
const FRAMEWORK_SLUGS: Record<FrameworkId, string> = {
  'next-app': 'nextjs',
  'next-pages': 'nextjs',
  'next-hybrid': 'nextjs',
  'vite-react': 'vite',
  'vite-svelte': 'vite',
  'vite-vue': 'vite',
  'sveltekit': 'sveltekit',
  'astro': 'astro',
  'remix': 'remix',
};

// ─── Public API ────────────────────────────────────────────────────────────

export async function createDeployment(
  opts: CreateDeploymentOptions,
): Promise<CreateDeploymentResult> {
  const filesPayload = await Promise.all(
    opts.files.map(async (f) => {
      const data = await fs.promises.readFile(f.absPath);
      return {
        file: f.relPath,
        data: data.toString('base64'),
        encoding: 'base64' as const,
      };
    }),
  );

  const body = {
    name: opts.projectName,
    files: filesPayload,
    target: opts.target ?? 'preview',
    projectSettings: {
      framework: FRAMEWORK_SLUGS[opts.framework] ?? null,
    },
    env: opts.env ?? {},
    build: {
      env: opts.env ?? {},
    },
  };

  const url = appendTeam(`${VERCEL_API_BASE}/v13/deployments`, opts.teamId);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vercel createDeployment ${res.status}: ${text.slice(0, 500)}`);
  }
  const data = (await res.json()) as { id: string; url: string; readyState: string };
  return {
    id: data.id,
    url: data.url,
    readyState: data.readyState,
  };
}

export async function pollDeployment(
  opts: PollDeploymentOptions,
): Promise<PollDeploymentResult> {
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const interval = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startTs = Date.now();
  const url = appendTeam(
    `${VERCEL_API_BASE}/v13/deployments/${encodeURIComponent(opts.deploymentId)}`,
    opts.teamId,
  );

  while (true) {
    const elapsedMs = Date.now() - startTs;
    const zone = zoneForElapsed(elapsedMs, timeout);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.token}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Vercel pollDeployment ${res.status}: ${text.slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      id: string;
      url: string;
      readyState: string;
      errorMessage?: string;
    };
    if (opts.onProgress) {
      opts.onProgress({ readyState: data.readyState, elapsedMs, zone });
    }
    if (data.readyState === 'READY') {
      return { id: data.id, url: data.url, readyState: 'READY', elapsedMs };
    }
    if (data.readyState === 'ERROR' || data.readyState === 'CANCELED') {
      return {
        id: data.id,
        url: data.url,
        readyState: data.readyState,
        elapsedMs,
        error: data.errorMessage ?? `Deployment entered ${data.readyState} state`,
      };
    }
    if (elapsedMs >= timeout) {
      return {
        id: data.id,
        url: data.url,
        readyState: 'TIMEOUT',
        elapsedMs,
        error: `Timed out waiting for deployment to reach READY (${Math.round(timeout / 1000)}s).`,
      };
    }
    await delay(interval);
  }
}

export async function deleteDeployment(opts: DeleteDeploymentOptions): Promise<void> {
  const url = appendTeam(
    `${VERCEL_API_BASE}/v13/deployments/${encodeURIComponent(opts.deploymentId)}`,
    opts.teamId,
  );
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${opts.token}` },
  });
  // Treat 404 as success — already deleted.
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vercel deleteDeployment ${res.status}: ${text.slice(0, 500)}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

export function zoneForElapsed(elapsedMs: number, timeoutMs: number): BuildZone {
  if (elapsedMs < EXPECTED_ZONE_END_MS) return 'expected';
  if (elapsedMs < timeoutMs) return 'taking-longer';
  return 'timeout';
}

function appendTeam(url: string, teamId: string | undefined): string {
  if (!teamId) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}teamId=${encodeURIComponent(teamId)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Light validity check of a Vercel personal access token. Uses GET
 * /v2/user — cheap, low-side-effect, works for personal + team tokens.
 * Returns { ok: boolean, message?: string } without throwing.
 */
export async function verifyVercelToken(token: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch(`${VERCEL_API_BASE}/v2/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, message: `Vercel auth ${res.status}: ${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, message: `Couldn't reach Vercel: ${(err as Error).message}` };
  }
}
