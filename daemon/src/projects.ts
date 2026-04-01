import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR, type ProjectV2, type Comment } from './protocol.js';

export function ensureProjectsDir(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function projectDir(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId);
}

function projectJsonPath(projectId: string): string {
  return path.join(projectDir(projectId), 'project.json');
}

function commentsJsonPath(projectId: string): string {
  return path.join(projectDir(projectId), 'comments.json');
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export function listProjects(): Array<{ name: string; projectId: string; contentType: string; modified: string; commentCount: number }> {
  ensureProjectsDir();
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects: Array<{ name: string; projectId: string; contentType: string; modified: string; commentCount: number }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(PROJECTS_DIR, entry.name, 'project.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const project = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ProjectV2;
      const comments = loadComments(entry.name);
      projects.push({
        name: project.name,
        projectId: entry.name,
        contentType: project.contentType,
        modified: project.modified,
        commentCount: comments.length,
      });
    } catch {
      // Skip corrupted project files
    }
  }

  return projects.sort((a, b) => b.modified.localeCompare(a.modified));
}

export function loadProject(projectId: string): ProjectV2 {
  const jsonPath = projectJsonPath(projectId);
  return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ProjectV2;
}

export function createProject(name: string, contentType: 'url' | 'pdf' | 'image', url?: string, file?: string): { project: ProjectV2; projectId: string } {
  ensureProjectsDir();
  const projectId = slugify(name) + '-' + crypto.randomBytes(3).toString('hex');
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });

  const now = new Date().toISOString();
  const project: ProjectV2 = {
    frank_version: '2',
    name,
    contentType,
    ...(url ? { url } : {}),
    ...(file ? { file } : {}),
    screens: {},
    screenOrder: [],
    capture: true,
    activeShare: null,
    created: now,
    modified: now,
  };

  atomicWrite(projectJsonPath(projectId), JSON.stringify(project, null, 2));
  atomicWrite(commentsJsonPath(projectId), '[]');
  return { project, projectId };
}

export function saveProject(projectId: string, project: ProjectV2): void {
  project.modified = new Date().toISOString();
  atomicWrite(projectJsonPath(projectId), JSON.stringify(project, null, 2));
}

export function deleteProject(projectId: string): void {
  const dir = projectDir(projectId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Screens ────────────────────────────────────────────────────────────────

export function addScreen(projectId: string, route: string, label: string): ProjectV2 {
  const project = loadProject(projectId);
  const screenId = slugify(label) + '-' + crypto.randomBytes(2).toString('hex');
  project.screens[screenId] = { route, label };
  project.screenOrder.push(screenId);
  saveProject(projectId, project);
  return project;
}

// ─── Comments ───────────────────────────────────────────────────────────────

export function loadComments(projectId: string): Comment[] {
  const jsonPath = commentsJsonPath(projectId);
  if (!fs.existsSync(jsonPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as Comment[];
  } catch {
    return [];
  }
}

export function addComment(projectId: string, comment: Omit<Comment, 'id' | 'ts' | 'status'>): Comment {
  const comments = loadComments(projectId);
  const newComment: Comment = {
    ...comment,
    id: 'c-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'),
    ts: new Date().toISOString(),
    status: 'pending',
  };
  comments.push(newComment);
  atomicWrite(commentsJsonPath(projectId), JSON.stringify(comments, null, 2));
  return newComment;
}

export function deleteComment(projectId: string, commentId: string): boolean {
  const comments = loadComments(projectId);
  const filtered = comments.filter(c => c.id !== commentId);
  if (filtered.length === comments.length) return false;
  atomicWrite(commentsJsonPath(projectId), JSON.stringify(filtered, null, 2));
  return true;
}
