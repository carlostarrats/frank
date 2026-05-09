// Pre-flight build + smoke validation for URL share. Implements §2.1 + §2.2
// from docs/url-share-auto-deploy-design.md.
//
// Protocol (deterministic, never random):
//   1. Build/install with generated env + FRANK_SHARE=1.
//      JS: npm run build.
//      Python: create an isolated temp venv, then install there.
//   2. If build passes, start on an ephemeral port.
//      JS: npm run start / preview.
//      Python: isolated-venv python -m uvicorn app.main:app.
//   3. curl / with redirect-follow → parse links → curl first 2 same-origin
//      routes (doc order). Fallback: Next.js routes-manifest alphabetical.
//   4. Keep server running 30s after last curl; tail stderr.
//   5. Count error-indicator lines (ECONNREFUSED/ENOTFOUND/getaddrinfo/fetch
//      failed/Invalid/not valid/Error:). Classify 🟢/🟡/🔴 per §2.3.

import { spawn } from 'child_process';
import * as net from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { EnvelopeFailure, FrameworkId } from './types.js';

// ─── Public types ──────────────────────────────────────────────────────────

export type SmokeReadiness = 'green' | 'yellow' | 'red';

export interface BuildStage {
  status: 'pass' | 'fail';
  durationMs: number;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
}

export interface ProbedRoute {
  url: string;
  pathname: string;
  httpStatus: number | null;
  error?: string;
}

export interface SmokeStage {
  status: 'pass' | 'fail' | 'skipped';
  readiness: SmokeReadiness;
  routes: ProbedRoute[];
  errorLineCount: number;
  errorSamples: string[];
  port: number | null;
  startupMs: number;
  usedFallbackRoutes: boolean;
}

export interface PreflightResult {
  status: 'pass' | 'fail';
  projectDir: string;
  framework: FrameworkId;
  build: BuildStage;
  smoke: SmokeStage | null;
  failures: EnvelopeFailure[];
}

export interface PreflightOptions {
  projectDir: string;
  framework: FrameworkId;
  /**
   * Env vars to inject into the build + start processes. Merged with a
   * minimal baseline so host env (PATH etc.) still works.
   */
  env?: Record<string, string>;
  /** Build timeout (ms). Default: 300_000 (5 min). */
  buildTimeoutMs?: number;
  /** Server startup wait (ms). Default: 20_000. */
  startupTimeoutMs?: number;
  /**
   * Seconds to keep the server running after the last curl for stderr
   * tailing. Default: 30 per §2.2. Override in tests to keep runs fast.
   */
  tailSeconds?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_BUILD_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 20 * 1000;
const DEFAULT_TAIL_SECONDS = 30;
const STDOUT_TAIL_CHARS = 4000;
const STDERR_TAIL_CHARS = 4000;

/**
 * Error-line patterns per §2.2. Each match counts as one occurrence. Case-
 * insensitive so we don't miss capitalized variants ("Error:" vs "error:").
 */
const ERROR_LINE_REGEX =
  /(ECONNREFUSED|ENOTFOUND|getaddrinfo|fetch\s+failed|Invalid\s+key|not\s+valid|Error:)/i;

/** §2.3 thresholds. Heuristic — expect to tune once real-user data lands. */
const GREEN_MAX = 5;
const YELLOW_MAX = 50;

// ─── Public entry ─────────────────────────────────────────────────────────

export async function runPreflight(opts: PreflightOptions): Promise<PreflightResult> {
  // Static HTML has no build step and no server to probe — Vercel serves
  // the files statically. Return a trivially-passing result so share-create
  // can continue to bundle + deploy. We still surface a real duration (0ms)
  // so the UI shows the stage as "skipped" rather than pretending the build
  // happened.
  if (opts.framework === 'static-html') {
    const build: BuildStage = {
      status: 'pass',
      durationMs: 0,
      exitCode: 0,
      stdoutTail: 'Static HTML — no build step.',
      stderrTail: '',
    };
    const smoke: SmokeStage = {
      status: 'skipped',
      readiness: 'green',
      routes: [],
      errorLineCount: 0,
      errorSamples: [],
      port: null,
      startupMs: 0,
      usedFallbackRoutes: false,
    };
    return {
      status: 'pass',
      projectDir: opts.projectDir,
      framework: opts.framework,
      build,
      smoke,
      failures: [],
    };
  }

  const pythonContext = opts.framework === 'fastapi-jinja'
    ? createPythonPreflightContext()
    : null;

  try {
    const build = await runBuild(opts, pythonContext);
    if (build.status === 'fail') {
      return {
        status: 'fail',
        projectDir: opts.projectDir,
        framework: opts.framework,
        build,
        smoke: null,
        failures: [
          {
            code: 'source-too-large', // misleading; we want a specific build-failed code
            message: `Pre-flight build failed (exit ${build.exitCode}).`,
            hint: `Check the build output — Frank can't deploy an app that doesn't build locally.`,
          },
        ],
      };
    }
    const smoke = await runSmoke(opts, pythonContext);
    const status: 'pass' | 'fail' = smoke.readiness === 'red' ? 'fail' : 'pass';
    return {
      status,
      projectDir: opts.projectDir,
      framework: opts.framework,
      build,
      smoke,
      failures: [],
    };
  } finally {
    cleanupPythonPreflightContext(pythonContext);
  }
}

// ─── Build stage (§2.1) ───────────────────────────────────────────────────

async function runBuild(
  opts: PreflightOptions,
  pythonContext: PythonPreflightContext | null,
): Promise<BuildStage> {
  const start = Date.now();
  const env = mergeEnv(opts.env);
  const buildSpecs = opts.framework === 'fastapi-jinja' && pythonContext
    ? buildPythonBuildCommands(opts.projectDir, pythonContext.venvDir)
    : [buildBuildCommand(opts.framework)];
  let stdout = '';
  let stderr = '';
  let exitCode: number | null = 0;

  for (const buildSpec of buildSpecs) {
    const result = await runChild({
      cmd: buildSpec.cmd,
      args: buildSpec.args,
      cwd: opts.projectDir,
      env,
      timeoutMs: opts.buildTimeoutMs ?? DEFAULT_BUILD_TIMEOUT_MS,
    });
    stdout += result.stdout;
    stderr += result.stderr;
    exitCode = result.exitCode;
    if (result.exitCode !== 0) break;
  }
  const durationMs = Date.now() - start;
  return {
    status: exitCode === 0 ? 'pass' : 'fail',
    durationMs,
    exitCode,
    stdoutTail: tail(stdout, STDOUT_TAIL_CHARS),
    stderrTail: tail(stderr, STDERR_TAIL_CHARS),
  };
}

// ─── Smoke stage (§2.2) ───────────────────────────────────────────────────

async function runSmoke(
  opts: PreflightOptions,
  pythonContext: PythonPreflightContext | null,
): Promise<SmokeStage> {
  const port = await findFreePort();
  const env = {
    ...mergeEnv(opts.env),
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    HOST: '127.0.0.1',
  };
  const startupTimeoutMs = opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const tailMs = (opts.tailSeconds ?? DEFAULT_TAIL_SECONDS) * 1000;

  const startSpec = buildStartCommand(opts.framework, port, pythonContext?.pythonCmd);
  const child = spawn(startSpec.cmd, startSpec.args, {
    cwd: opts.projectDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrBuffer = '';
  let errorLineCount = 0;
  const errorSamples: string[] = [];
  // Only count errors that occur AFTER the server is marked ready. A lot of
  // frameworks emit "Warning: ..." or deprecation lines during boot that are
  // not actionable signal for us.
  let counting = false;
  // Pre-ready output kept so we can surface it if startup fails — without
  // this, a dead server yields a blank error and the user has no signal.
  let preReadyStdout = '';
  let preReadyStderr = '';
  let spawnError: Error | null = null;

  const attachStderrCounter = (): void => {
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      if (!counting) preReadyStderr += text;
      if (counting) {
        stderrBuffer += text;
        const lines = stderrBuffer.split('\n');
        stderrBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (ERROR_LINE_REGEX.test(line)) {
            errorLineCount++;
            if (errorSamples.length < 10) errorSamples.push(line.trim());
          }
        }
      }
    });
    // Drain stdout too — unconsumed pipe fills up the buffer and blocks the
    // child's subsequent writes, which can look like "server never started."
    child.stdout?.on('data', (chunk: Buffer) => {
      if (!counting) preReadyStdout += chunk.toString('utf-8');
    });
  };
  attachStderrCounter();
  const spawnFailure = new Promise<never>((_, reject) => {
    child.once('error', (err) => {
      spawnError = err;
      reject(err);
    });
  });

  const startupStart = Date.now();
  try {
    await Promise.race([waitForServerReady(port, startupTimeoutMs), spawnFailure]);
  } catch {
    if (!spawnError) child.kill('SIGTERM');
    // Surface pre-ready output so the user can see why startup failed. A
    // blank readiness:red verdict without context is useless.
    const samples = spawnError
      ? [formatSpawnError(startSpec, spawnError)]
      : extractStartupFailureSamples(preReadyStdout, preReadyStderr);
    return {
      status: 'fail',
      readiness: 'red',
      routes: [],
      errorLineCount: samples.length,
      errorSamples: samples,
      port,
      startupMs: Date.now() - startupStart,
      usedFallbackRoutes: false,
    };
  }
  const startupMs = Date.now() - startupStart;
  counting = true;

  // Probe /
  const rootUrl = `http://127.0.0.1:${port}/`;
  const rootProbe = await probeRoute(rootUrl);
  const routes: ProbedRoute[] = [rootProbe];

  // Extract links from root response body
  let links: string[] = [];
  let usedFallback = false;
  if (rootProbe.body) {
    links = extractSameOriginLinks(rootProbe.body, `http://127.0.0.1:${port}`).slice(0, 2);
  }

  // Fallback: Next.js routes-manifest if <2 links found
  if (links.length < 2 && opts.framework.startsWith('next-')) {
    const manifestRoutes = readNextRoutesManifest(opts.projectDir);
    if (manifestRoutes.length > 0) {
      // Fill up to 2, skipping / (already probed)
      const extra = manifestRoutes
        .filter((r) => r !== '/')
        .slice(0, 2 - links.length)
        .map((r) => `http://127.0.0.1:${port}${r}`);
      if (extra.length > 0) {
        links = [...links, ...extra];
        usedFallback = true;
      }
    }
  }

  for (const url of links.slice(0, 2)) {
    const probe = await probeRoute(url);
    routes.push(probe);
  }

  // 30s tail
  await delay(tailMs);

  child.kill('SIGTERM');
  // Give it a moment to shut down cleanly before we return
  await delay(500);

  const readiness: SmokeReadiness =
    errorLineCount <= GREEN_MAX ? 'green' : errorLineCount <= YELLOW_MAX ? 'yellow' : 'red';
  return {
    status: readiness === 'red' ? 'fail' : 'pass',
    readiness,
    routes,
    errorLineCount,
    errorSamples,
    port,
    startupMs,
    usedFallbackRoutes: usedFallback,
  };
}

// ─── Child process runner ─────────────────────────────────────────────────

interface ChildRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface ChildRunSpec {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

interface PythonPreflightContext {
  scratchDir: string;
  venvDir: string;
  pythonCmd: string;
}

function runChild(spec: ChildRunSpec): Promise<ChildRunResult> {
  return new Promise((resolve) => {
    const child = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (c) => { stdout += c.toString('utf-8'); });
    child.stderr?.on('data', (c) => { stderr += c.toString('utf-8'); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, spec.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      stderr += `\n[spawn error] ${err.message}`;
      resolve({ exitCode: null, stdout, stderr, timedOut });
    });
  });
}

// ─── Framework-aware commands ─────────────────────────────────────────────

interface CommandSpec {
  cmd: string;
  args: string[];
}

export function buildBuildCommand(framework: FrameworkId): CommandSpec {
  void framework;
  return { cmd: 'npm', args: ['run', 'build'] };
}

export function buildPythonBuildCommands(
  projectDir: string,
  venvDir: string,
  hasRequirements = fs.existsSync(path.join(projectDir, 'requirements.txt')),
): CommandSpec[] {
  const pythonCmd = getPythonVenvPythonCmd(venvDir);
  return [
    { cmd: 'python3', args: ['-m', 'venv', venvDir] },
    hasRequirements
      ? { cmd: pythonCmd, args: ['-m', 'pip', 'install', '-r', 'requirements.txt'] }
      : { cmd: pythonCmd, args: ['-m', 'pip', 'install', '.'] },
  ];
}

export function buildStartCommand(
  framework: FrameworkId,
  port: number,
  pythonCmd = 'python3',
): CommandSpec {
  if (framework === 'fastapi-jinja') {
    return {
      cmd: pythonCmd,
      args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    };
  }
  // Next.js and Remix use PORT env; Vite-based frameworks take --port as CLI.
  if (framework.startsWith('next-') || framework === 'remix') {
    return { cmd: 'npm', args: ['run', 'start'] };
  }
  // Vite + SvelteKit + Astro all expose `preview` with a --port flag.
  return {
    cmd: 'npm',
    args: ['run', 'preview', '--', '--port', String(port), '--host', '127.0.0.1'],
  };
}

// ─── Ephemeral port ───────────────────────────────────────────────────────

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close();
        reject(new Error('could not determine port'));
      }
    });
  });
}

// ─── Server readiness poll ────────────────────────────────────────────────

async function waitForServerReady(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: controller.signal,
      });
      clearTimeout(t);
      // Any HTTP response (including 4xx/5xx) means the server is listening.
      if (res) return;
    } catch {
      // connection refused yet — wait and retry
    }
    await delay(500);
  }
  throw new Error(`Server did not become ready on port ${port} within ${timeoutMs}ms`);
}

// ─── Route probe ───────────────────────────────────────────────────────────

interface ProbeResultInternal extends ProbedRoute {
  body?: string;
}

async function probeRoute(url: string): Promise<ProbeResultInternal> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(t);
    const body = await res.text();
    return {
      url,
      pathname: new URL(res.url).pathname,
      httpStatus: res.status,
      body,
    };
  } catch (err) {
    return {
      url,
      pathname: new URL(url).pathname,
      httpStatus: null,
      error: (err as Error).message,
    };
  }
}

// ─── Link extraction (§2.2 step 3) ────────────────────────────────────────

const HREF_REGEX = /<a\b[^>]*\shref\s*=\s*["']([^"']+)["']/gi;
const NON_NAV_SCHEMES = /^(?:javascript|mailto|tel|data|blob|sms):/i;

export function extractSameOriginLinks(html: string, origin: string): string[] {
  const hrefs: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  HREF_REGEX.lastIndex = 0;
  while ((match = HREF_REGEX.exec(html))) {
    const raw = match[1];
    if (!raw) continue;
    if (raw.startsWith('#')) continue;
    if (NON_NAV_SCHEMES.test(raw)) continue;
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    url.hash = '';
    const str = url.toString();
    // Skip the bare origin root — we already probed /
    if (url.pathname === '/' && !url.search) continue;
    if (!seen.has(str)) {
      seen.add(str);
      hrefs.push(str);
    }
  }
  return hrefs;
}

// ─── Next.js routes manifest fallback (§2.2 step 3) ───────────────────────

interface NextRoutesManifest {
  staticRoutes?: Array<{ page: string }>;
  dynamicRoutes?: Array<{ page: string }>;
}

export function readNextRoutesManifest(projectDir: string): string[] {
  const manifestPath = path.join(projectDir, '.next', 'routes-manifest.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as NextRoutesManifest;
    const staticPages = (manifest.staticRoutes ?? []).map((r) => r.page);
    // Deterministic alphabetical sort; exclude internal routes that won't
    // render usefully (_not-found, robots.txt, sitemap.xml).
    return staticPages
      .filter((p) => !/^\/_/.test(p))
      .filter((p) => !/\.(xml|txt)$/.test(p))
      .sort();
  } catch {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function mergeEnv(extra: Record<string, string> | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    FRANK_SHARE: '1',
    ...(extra ?? {}),
  };
}

function createPythonPreflightContext(): PythonPreflightContext {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-python-preflight-'));
  const venvDir = path.join(scratchDir, 'venv');
  return {
    scratchDir,
    venvDir,
    pythonCmd: getPythonVenvPythonCmd(venvDir),
  };
}

function cleanupPythonPreflightContext(context: PythonPreflightContext | null): void {
  if (!context) return;
  fs.rmSync(context.scratchDir, { recursive: true, force: true });
}

function getPythonVenvPythonCmd(venvDir: string): string {
  return path.join(venvDir, 'bin', 'python');
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function tail(s: string, chars: number): string {
  if (s.length <= chars) return s;
  return '…' + s.slice(s.length - chars);
}

// ─── Exposed classifier for tests/UI ──────────────────────────────────────

export function classifyReadiness(errorLineCount: number, buildFailed: boolean): SmokeReadiness {
  if (buildFailed) return 'red';
  if (errorLineCount <= GREEN_MAX) return 'green';
  if (errorLineCount <= YELLOW_MAX) return 'yellow';
  return 'red';
}

export function countErrorLines(stderr: string): { count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  for (const line of stderr.split('\n')) {
    if (ERROR_LINE_REGEX.test(line)) {
      count++;
      if (samples.length < 10) samples.push(line.trim());
    }
  }
  return { count, samples };
}

function extractStartupFailureSamples(stdout: string, stderr: string): string[] {
  const combined = [stdout, stderr].filter(Boolean).join('\n').trim();
  return combined
    ? tail(combined, 2000).split('\n').filter(Boolean).slice(-10)
    : [];
}

export function formatSpawnError(command: CommandSpec, err: Error): string {
  const rendered = [command.cmd, ...command.args].join(' ');
  return `[spawn error] ${rendered}: ${err.message}`;
}
