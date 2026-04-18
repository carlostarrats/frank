// scaffold.ts — Spin One Up.
//
// Copies a template directory into a target path, optionally runs `npm install`
// streaming its output back to the caller, and spawns a dev server whose URL
// is detected from stdout. Tracks live child processes so we can kill them on
// daemon shutdown.
//
// All long-running work is callback-based: the caller gets onLog(chunk, stream)
// for every chunk, onReady(url) once the dev URL is detected, and onExit(code)
// when the server process exits. That keeps scaffold.ts independent of the
// WebSocket transport — server.ts marshals callbacks into messages.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { PROJECTS_DIR, type ProjectV2 } from './protocol.js';
import { ensureProjectsDir, slugify } from './projects.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Templates ship inside the daemon package at daemon/templates/.
// From the compiled file at daemon/dist/scaffold.js, that's ../templates.
export const DEFAULT_TEMPLATES_DIR = path.resolve(__dirname, '../templates');

export interface ScaffoldTemplate {
  id: string;
  name: string;
  description: string;
  needsInstall: boolean;
  installCommand?: [string, ...string[]];
  devCommand: [string, ...string[]];
  estimatedInstallSeconds: number;
}

export const TEMPLATES: ScaffoldTemplate[] = [
  {
    id: 'static',
    name: 'Static HTML / CSS / JS',
    description: 'Plain HTML, CSS, and JavaScript served by a tiny Node HTTP server. No build step, no install.',
    needsInstall: false,
    devCommand: ['node', 'server.js'],
    estimatedInstallSeconds: 0,
  },
  {
    id: 'vite-react',
    name: 'Vite + React',
    description: 'React with Vite dev server and hot module replacement. Requires npm install (~30–60 seconds).',
    needsInstall: true,
    installCommand: ['npm', 'install'],
    devCommand: ['npm', 'run', 'dev'],
    estimatedInstallSeconds: 45,
  },
];

export function listTemplates(): ScaffoldTemplate[] {
  return TEMPLATES;
}

export function findTemplate(id: string): ScaffoldTemplate | null {
  return TEMPLATES.find((t) => t.id === id) || null;
}

// Tracked running processes, keyed by project ID. On daemon shutdown we
// SIGTERM each and escalate to SIGKILL after a short grace period.
interface RunningServer {
  process: ChildProcess;
  templateId: string;
  url: string;
  projectId: string;
  cwd: string;
  startedAt: string;
}
const running = new Map<string, RunningServer>();

export function getRunningServer(projectId: string): { templateId: string; url: string; cwd: string; startedAt: string } | null {
  const s = running.get(projectId);
  if (!s) return null;
  return { templateId: s.templateId, url: s.url, cwd: s.cwd, startedAt: s.startedAt };
}

export function listRunningServers(): Array<{ projectId: string; templateId: string; url: string; startedAt: string }> {
  return Array.from(running.values()).map((s) => ({
    projectId: s.projectId,
    templateId: s.templateId,
    url: s.url,
    startedAt: s.startedAt,
  }));
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export interface ScaffoldResult {
  projectId: string;
  scaffoldPath: string;
  template: ScaffoldTemplate;
}

export function scaffoldProject(params: {
  templateId: string;
  name: string;
  targetDir: string;
  templatesDir?: string;
}): ScaffoldResult {
  const template = findTemplate(params.templateId);
  if (!template) throw new Error(`Unknown template: ${params.templateId}`);

  const templatesRoot = params.templatesDir || DEFAULT_TEMPLATES_DIR;
  const srcDir = path.join(templatesRoot, template.id);
  if (!fs.existsSync(srcDir)) throw new Error(`Template files missing: ${srcDir}`);

  const slug = slugify(params.name);
  if (!slug) throw new Error('Project name is empty or invalid');

  const scaffoldPath = path.resolve(params.targetDir, slug);
  if (fs.existsSync(scaffoldPath)) throw new Error(`Target directory already exists: ${scaffoldPath}`);

  fs.mkdirSync(scaffoldPath, { recursive: true });
  copyDirRecursive(srcDir, scaffoldPath);

  const pkgPath = path.join(scaffoldPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.name = slug;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    } catch { /* leave unchanged if unreadable */ }
  }

  // Frank project metadata — scaffolded projects are URL-review projects
  // once the dev server starts; we fill the URL in after detection.
  ensureProjectsDir();
  const projectId = slug + '-' + crypto.randomBytes(3).toString('hex');
  const projectDir = path.join(PROJECTS_DIR, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'snapshots'), { recursive: true });

  const now = new Date().toISOString();
  const project: ProjectV2 & { scaffoldPath?: string; scaffoldTemplate?: string } = {
    frank_version: '2',
    name: params.name,
    contentType: 'url',
    url: '',
    screens: {},
    screenOrder: [],
    capture: true,
    activeShare: null,
    created: now,
    modified: now,
    scaffoldPath,
    scaffoldTemplate: template.id,
  };
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(project, null, 2), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'comments.json'), '[]', 'utf8');

  return { projectId, scaffoldPath, template };
}

export async function runInstall(params: {
  cwd: string;
  template: ScaffoldTemplate;
  onLog: (chunk: string, stream: 'stdout' | 'stderr') => void;
}): Promise<{ exitCode: number }> {
  if (!params.template.installCommand) return { exitCode: 0 };
  return new Promise((resolve) => {
    const [cmd, ...args] = params.template.installCommand!;
    const child = spawn(cmd, args, {
      cwd: params.cwd,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    child.stdout.on('data', (buf) => params.onLog(buf.toString(), 'stdout'));
    child.stderr.on('data', (buf) => params.onLog(buf.toString(), 'stderr'));
    child.on('error', (err) => {
      params.onLog(`install error: ${err.message}\n`, 'stderr');
      resolve({ exitCode: -1 });
    });
    child.on('close', (code) => resolve({ exitCode: code ?? -1 }));
  });
}

// Matches `http://localhost:<port>` (or 127.0.0.1) anywhere in a chunk. Most
// dev servers print this when ready. We keep it loose on purpose — Vite, Next,
// CRA, Node's http, and Webpack all print some variant of this line.
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/;

export function startDevServer(params: {
  projectId: string;
  cwd: string;
  template: ScaffoldTemplate;
  onLog: (chunk: string, stream: 'stdout' | 'stderr') => void;
  onReady: (url: string) => void;
  onExit: (code: number | null) => void;
}): void {
  const [cmd, ...args] = params.template.devCommand;
  const child = spawn(cmd, args, {
    cwd: params.cwd,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });

  let urlDetected = false;
  const detectUrl = (chunk: string) => {
    if (urlDetected) return;
    const m = URL_PATTERN.exec(chunk);
    if (m && m[0]) {
      urlDetected = true;
      const url = m[0].replace(/\/$/, '');
      running.set(params.projectId, {
        process: child,
        templateId: params.template.id,
        url,
        projectId: params.projectId,
        cwd: params.cwd,
        startedAt: new Date().toISOString(),
      });
      params.onReady(url);
    }
  };

  child.stdout.on('data', (buf) => {
    const text = buf.toString();
    params.onLog(text, 'stdout');
    detectUrl(text);
  });
  child.stderr.on('data', (buf) => {
    const text = buf.toString();
    params.onLog(text, 'stderr');
    detectUrl(text);
  });
  child.on('error', (err) => {
    params.onLog(`dev server error: ${err.message}\n`, 'stderr');
    running.delete(params.projectId);
    params.onExit(-1);
  });
  child.on('close', (code) => {
    running.delete(params.projectId);
    params.onExit(code);
  });
}

export function stopDevServer(projectId: string, { gracePeriodMs = 5000 } = {}): boolean {
  const server = running.get(projectId);
  if (!server) return false;
  try {
    server.process.kill('SIGTERM');
  } catch { /* already dead */ }
  setTimeout(() => {
    try {
      if (!server.process.killed) server.process.kill('SIGKILL');
    } catch { /* already dead */ }
  }, gracePeriodMs);
  running.delete(projectId);
  return true;
}

export function cleanupAllServers(): void {
  for (const [projectId] of Array.from(running.entries())) {
    stopDevServer(projectId, { gracePeriodMs: 2000 });
  }
}
