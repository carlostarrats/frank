import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR, ARCHIVE_DIR } from './protocol.js';

export function ensureProjectsDir(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function listProjects(): Array<{ label: string; filePath: string; modifiedAt: string; screenCount: number }> {
  ensureProjectsDir();
  const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.frank.json'));
  return files.map(f => {
    const filePath = path.join(PROJECTS_DIR, f);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const stat = fs.statSync(filePath);
      return {
        label: content.label || f.replace('.frank.json', ''),
        filePath,
        modifiedAt: stat.mtime.toISOString(),
        screenCount: content.screenOrder ? content.screenOrder.length : 0,
      };
    } catch {
      return { label: f.replace('.frank.json', ''), filePath, modifiedAt: '', screenCount: 0 };
    }
  });
}

export function loadProject(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content);
}

export function saveProject(project: Record<string, unknown>): string {
  ensureProjectsDir();
  const label = (project.label as string) || 'Untitled';
  const filePath = (project._filePath as string) || path.join(PROJECTS_DIR, `${slugify(label)}.frank.json`);
  const { _filePath: _, ...rest } = project;
  const toSave = { ...rest, savedAt: new Date().toISOString() };
  atomicWrite(filePath, JSON.stringify(toSave, null, 2));
  return filePath;
}

export function createProject(label: string): { project: Record<string, unknown>; filePath: string } {
  ensureProjectsDir();
  const id = slugify(label);
  const filePath = path.join(PROJECTS_DIR, `${id}.frank.json`);
  const project: Record<string, unknown> = {
    schema: 'v1',
    type: 'project',
    label,
    savedAt: new Date().toISOString(),
    screens: {},
    screenOrder: [],
    activeShare: null,
    shareHistory: [],
    timeline: [],
  };
  atomicWrite(filePath, JSON.stringify(project, null, 2));
  return { project, filePath };
}

export function archiveProject(filePath: string): boolean {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const dest = path.join(ARCHIVE_DIR, path.basename(filePath));
  fs.renameSync(filePath, dest);
  return true;
}

export function mergeScreenIntoProject(projectFilePath: string, screen: Record<string, unknown>): Record<string, unknown> {
  const content = fs.readFileSync(projectFilePath, 'utf8');
  const project = JSON.parse(content) as Record<string, unknown>;
  const screens = (project.screens || {}) as Record<string, unknown>;
  const screenOrder = (project.screenOrder || []) as string[];

  const screenLabel = (screen.label as string) || 'Untitled Screen';
  const screenId = (screen.id as string) || slugify(screenLabel);

  if (screens[screenId]) {
    screens[screenId] = { ...(screens[screenId] as object), ...screen, id: undefined };
  } else {
    screens[screenId] = { ...screen, id: undefined };
    screenOrder.push(screenId);
  }

  project.screens = screens;
  project.screenOrder = screenOrder;
  project.savedAt = new Date().toISOString();

  atomicWrite(projectFilePath, JSON.stringify(project, null, 2));
  return project;
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function getGitUserName(): string {
  try {
    const { execSync } = require('child_process');
    return execSync('git config user.name', { encoding: 'utf8' }).trim() || 'You';
  } catch {
    return 'You';
  }
}
