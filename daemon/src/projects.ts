import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PROJECTS_DIR, type ProjectV2, type Comment, type ProjectSummary, type V0ChatTarget } from './protocol.js';

// Soft-deleted projects live on disk for 30 days before auto-purge.
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

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

export function listProjects(): ProjectSummary[] {
  ensureProjectsDir();
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects: ProjectSummary[] = [];

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
        ...(project.archived ? { archived: project.archived } : {}),
        ...(project.trashed ? { trashed: project.trashed } : {}),
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

// Create a project from an uploaded file (PDF or image). Writes the raw bytes
// into the project's source/ subdir and returns a project whose `file` field
// points at a /files/-servable relative path.
export function createProjectFromFile(name: string, contentType: 'pdf' | 'image', fileName: string, data: Buffer): { project: ProjectV2; projectId: string } {
  ensureProjectsDir();
  const projectId = slugify(name) + '-' + crypto.randomBytes(3).toString('hex');
  const dir = projectDir(projectId);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'source'), { recursive: true });

  const safeName = fileName.replace(/[^\w.\- ]+/g, '_');
  const sourcePath = path.join(dir, 'source', safeName);
  fs.writeFileSync(sourcePath, data);
  const relativePath = `projects/${projectId}/source/${safeName}`;

  const now = new Date().toISOString();
  const project: ProjectV2 = {
    frank_version: '2',
    name,
    contentType,
    file: relativePath,
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

export function createProject(name: string, contentType: 'url' | 'pdf' | 'image' | 'canvas', url?: string, file?: string): { project: ProjectV2; projectId: string } {
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
    ...(contentType === 'canvas' ? { canvasEnabled: true } : {}),
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

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function renameProject(projectId: string, name: string): ProjectV2 {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Project name cannot be empty');
  const project = loadProject(projectId);
  project.name = trimmed;
  saveProject(projectId, project);
  return project;
}

// Empty string clears the intent (field removed). Length capped at 2000 chars
// to keep the AI-handoff payload bounded.
export function setProjectIntent(projectId: string, intent: string): ProjectV2 {
  const trimmed = (intent || '').trim().slice(0, 2000);
  const project = loadProject(projectId);
  if (trimmed) project.intent = trimmed;
  else delete project.intent;
  saveProject(projectId, project);
  return project;
}

// Empty string clears the sourceDir (field removed). Stored verbatim — not
// validated against the filesystem here; the share flow checks existence at
// deploy time. Only URL projects use this today, but no contentType gate so
// future content types (e.g. local-served PDF) can reuse the field.
export function setProjectSourceDir(projectId: string, sourceDir: string): ProjectV2 {
  const trimmed = (sourceDir || '').trim();
  const project = loadProject(projectId);
  if (trimmed) project.sourceDir = trimmed;
  else delete project.sourceDir;
  saveProject(projectId, project);
  return project;
}

/**
 * Append a v0 chat target to the project's list, or update label/lastUsedAt
 * in place if the chatId is already present. `addedAt` is always set by this
 * function — the caller's value is ignored.
 */
export function addV0Chat(projectId: string, target: V0ChatTarget): void {
  const project = loadProject(projectId);
  const list = project.v0Chats ?? [];
  const existing = list.findIndex(c => c.chatId === target.chatId);
  if (existing >= 0) {
    // Preserve the original addedAt; overwrite the rest
    list[existing] = { ...target, addedAt: list[existing].addedAt };
  } else {
    list.push({ ...target, addedAt: new Date().toISOString() });
  }
  project.v0Chats = list;
  saveProject(projectId, project);
}

export function removeV0Chat(projectId: string, chatId: string): void {
  const project = loadProject(projectId);
  if (!project.v0Chats) return;
  const before = project.v0Chats.length;
  project.v0Chats = project.v0Chats.filter(c => c.chatId !== chatId);
  if (project.v0Chats.length === before) return;       // no-op when chatId wasn't present
  if (project.v0Chats.length === 0) delete project.v0Chats;
  saveProject(projectId, project);
}

export function touchV0Chat(projectId: string, chatId: string): void {
  const project = loadProject(projectId);
  if (!project.v0Chats) return;
  const target = project.v0Chats.find(c => c.chatId === chatId);
  if (!target) return;
  target.lastUsedAt = new Date().toISOString();
  saveProject(projectId, project);
}

export function archiveProject(projectId: string): ProjectV2 {
  const project = loadProject(projectId);
  project.archived = new Date().toISOString();
  saveProject(projectId, project);
  return project;
}

export function unarchiveProject(projectId: string): ProjectV2 {
  const project = loadProject(projectId);
  delete project.archived;
  saveProject(projectId, project);
  return project;
}

// Soft delete. Project stays on disk for TRASH_RETENTION_MS, then purged.
export function trashProject(projectId: string): ProjectV2 {
  const project = loadProject(projectId);
  project.trashed = new Date().toISOString();
  saveProject(projectId, project);
  return project;
}

export function restoreProject(projectId: string): ProjectV2 {
  const project = loadProject(projectId);
  delete project.trashed;
  saveProject(projectId, project);
  return project;
}

// Remove trashed projects whose trashed timestamp is older than TRASH_RETENTION_MS.
// Called at daemon startup.
export function purgeExpiredTrash(now: number = Date.now()): string[] {
  ensureProjectsDir();
  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const purged: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(PROJECTS_DIR, entry.name, 'project.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const project = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ProjectV2;
      if (project.trashed && now - new Date(project.trashed).getTime() > TRASH_RETENTION_MS) {
        deleteProject(entry.name);
        purged.push(entry.name);
      }
    } catch {
      // Skip corrupted project files
    }
  }
  return purged;
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

export function mergeCloudComments(
  projectId: string,
  cloudComments: Array<{ id: string; author: string; screenId: string; anchor: unknown; text: string; ts: string }>,
): { newCount: number; lastId: string | null } {
  const existing = loadComments(projectId);
  const existingIds = new Set(existing.map(c => c.id));
  let newCount = 0;

  for (const cc of cloudComments) {
    if (!existingIds.has(cc.id)) {
      existing.push({
        id: cc.id,
        screenId: cc.screenId,
        anchor: cc.anchor as any,
        author: cc.author,
        text: cc.text,
        ts: cc.ts,
        status: 'pending',
      });
      newCount++;
    }
  }

  if (newCount > 0) {
    atomicWrite(commentsJsonPath(projectId), JSON.stringify(existing, null, 2));
  }

  const lastId = cloudComments.length > 0 ? cloudComments[cloudComments.length - 1].id : null;
  return { newCount, lastId };
}
