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

/** Framework IDs → Vercel framework slugs. `null` means "no framework" —
 *  Vercel deploys the files as a static site with no build step. */
const FRAMEWORK_SLUGS: Record<FrameworkId, string | null> = {
  'next-app': 'nextjs',
  'next-pages': 'nextjs',
  'next-hybrid': 'nextjs',
  'vite-react': 'vite',
  'vite-svelte': 'vite',
  'vite-vue': 'vite',
  'sveltekit': 'sveltekit',
  'astro': 'astro',
  'remix': 'remix',
  'static-html': null,
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

export interface StreamBuildLogsOptions {
  token: string;
  deploymentId: string;
  teamId?: string;
  /** Fires on every build-log line as it arrives from Vercel. */
  onLine: (evt: BuildLogEvent) => void;
  /** AbortSignal to stop the stream early — typically fired when the
   *  deployment reaches a terminal state elsewhere (pollDeployment saw
   *  READY) or the caller decides to give up. */
  signal?: AbortSignal;
  /** Hard timeout for the stream itself (not the deployment). Default 10min
   *  so a genuinely-stuck build doesn't leak an open fetch forever. */
  timeoutMs?: number;
}

export interface BuildLogEvent {
  /** Vercel event type — observed values include `stdout`, `stderr`,
   *  `command`, `deployment-state`, `fatal`. Kept as string so Vercel
   *  can add types without us having to chase the enum. */
  type: string;
  /** Unix-ms timestamp from Vercel. Used to compute relative time. */
  created?: number;
  /** Plain log text. For `deployment-state` events this is the new state;
   *  for stdout/stderr it's the raw line. Already newline-stripped. */
  text?: string;
  /** Original untouched event payload, in case the caller needs the raw
   *  JSON (e.g. `payload` sub-objects). */
  raw: Record<string, unknown>;
}

/**
 * Stream Vercel build logs for a deployment. Opens a single long-running
 * GET to `/v3/deployments/:id/events?follow=1&builds=1` and splits the
 * newline-delimited JSON body into events, firing `onLine` for each one.
 *
 * Resolves when the stream ends naturally (Vercel closes after terminal
 * state) or when `signal` is aborted. Network errors are swallowed and
 * logged to console — the deployment poll loop is the authoritative
 * source of truth for success/failure; logs are surface-only.
 *
 * Usage pattern: run alongside `pollDeployment` via Promise.race/all.
 * When pollDeployment resolves, abort the stream so we stop reading.
 */
export async function streamBuildLogs(
  opts: StreamBuildLogsOptions,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const timeoutController = new AbortController();
  const timeoutTimer = setTimeout(() => timeoutController.abort(), timeoutMs);

  // Combine user's signal with our timeout so either aborts the stream.
  const abortSignals: AbortSignal[] = [timeoutController.signal];
  if (opts.signal) abortSignals.push(opts.signal);
  const combined = anySignal(abortSignals);

  const url = appendTeam(
    `${VERCEL_API_BASE}/v3/deployments/${encodeURIComponent(opts.deploymentId)}/events?follow=1&builds=1`,
    opts.teamId,
  );

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${opts.token}` },
      signal: combined,
    });
    if (!res.ok) {
      // Non-2xx on the events endpoint is non-fatal — just means we can't
      // stream logs for this deployment. Poll loop covers success detection.
      return;
    }
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch {
        // Aborted or network hiccup — stop cleanly.
        break;
      }
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });

      // Vercel emits newline-delimited JSON objects. Split + parse whole
      // lines; leave the trailing partial in the buffer for next read.
      let newlineIdx = buffer.indexOf('\n');
      while (newlineIdx >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (line) {
          try {
            const raw = JSON.parse(line) as Record<string, unknown>;
            const evt: BuildLogEvent = {
              type: String(raw.type ?? 'unknown'),
              created: typeof raw.created === 'number' ? raw.created : undefined,
              text: typeof raw.text === 'string' ? raw.text : undefined,
              raw,
            };
            try { opts.onLine(evt); } catch { /* swallow consumer bugs */ }
          } catch {
            // Malformed line — skip, don't break the stream.
          }
        }
        newlineIdx = buffer.indexOf('\n');
      }
    }
  } catch {
    // Fetch-level failure. Log streaming is best-effort; we don't want a
    // socket blip to cascade into a share-create failure when the deployment
    // itself is fine.
  } finally {
    clearTimeout(timeoutTimer);
  }
}

// Node's AbortSignal.any() is Node 20+. We target >=18, so ship our own.
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of signals) {
    if (s.aborted) { controller.abort(); break; }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return controller.signal;
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

export interface DisableProtectionOptions {
  token: string;
  /** Project name or id. createDeployment auto-creates the project on first
   *  deploy with this name, so either identifier resolves server-side. */
  projectIdOrName: string;
  teamId?: string;
}

/**
 * Turn OFF Vercel Authentication (SSO Protection) and Password Protection on
 * the Frank-owned preview project so anonymous reviewers can open the share
 * link without hitting a login wall.
 *
 * Why this exists: Vercel's Hobby + Pro accounts default new projects to
 * "Vercel Authentication — Standard Protection," which returns HTTP 401 SSO
 * to any visitor that isn't logged into the project's team. The design doc §6
 * didn't cover this originally. Without this call, every Frank share link
 * shows Vercel's auth page, which breaks the core promise of URL share —
 * reviewer should open the link in a private window with no Vercel account
 * and interact with the running app.
 *
 * The PATCH is best-effort: if Vercel rejects (permission, missing project),
 * we return an error but do NOT fail the whole share — the user still gets
 * a working deployment URL, they just need to turn protection off manually
 * in the Vercel dashboard. That degradation is visible to the caller so the
 * UI can surface a hint.
 */
export async function disableDeploymentProtection(
  opts: DisableProtectionOptions,
): Promise<{ ok: boolean; message?: string }> {
  try {
    const url = appendTeam(
      `${VERCEL_API_BASE}/v9/projects/${encodeURIComponent(opts.projectIdOrName)}`,
      opts.teamId,
    );
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
      },
      // Both keys set to null: clears Vercel Authentication (SSO) and
      // Password Protection. Either would block reviewers; clearing both
      // is the only state that matches "reviewer opens preview in private
      // window, sees app."
      body: JSON.stringify({ ssoProtection: null, passwordProtection: null }),
    });
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => '');
    return { ok: false, message: `Vercel disableProtection ${res.status}: ${text.slice(0, 300)}` };
  } catch (err) {
    return { ok: false, message: `Couldn't reach Vercel: ${(err as Error).message}` };
  }
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
