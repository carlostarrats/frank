import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';
import type { Comment, ProjectV2 } from './protocol.js';
import { loadComments } from './projects.js';

export interface ImageLivePayload {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

function mimeForFile(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext ? MIME_BY_EXT[ext] || null : null;
}

function resolveSourcePath(projectId: string, file: string): string {
  // `file` in ProjectV2 is stored as e.g. "projects/<id>/source/<name>". Rebuild
  // the path from PROJECTS_DIR so we can't be tricked into reading files
  // outside the projects directory.
  const segments = file.split('/');
  // Expected shape: ['projects', '<id>', 'source', '<filename>']
  if (segments.length !== 4 || segments[0] !== 'projects' || segments[2] !== 'source') {
    return '';
  }
  const projectIdFromPath = segments[1];
  const filename = segments[3];
  if (projectIdFromPath !== projectId) return '';
  return path.join(PROJECTS_DIR, projectId, 'source', filename);
}

function loadProjectJson(projectId: string): ProjectV2 | null {
  try {
    const raw = fs.readFileSync(path.join(PROJECTS_DIR, projectId, 'project.json'), 'utf8');
    return JSON.parse(raw) as ProjectV2;
  } catch {
    return null;
  }
}

export async function buildImageLivePayload(projectId: string): Promise<ImageLivePayload | null> {
  const project = loadProjectJson(projectId);
  if (!project || project.contentType !== 'image' || !project.file) return null;

  const sourcePath = resolveSourcePath(projectId, project.file);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  const mimeType = mimeForFile(sourcePath);
  if (!mimeType) return null;

  let bytes: Buffer;
  try { bytes = fs.readFileSync(sourcePath); } catch { return null; }

  const comments = loadComments(projectId);

  return {
    fileDataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    mimeType,
    comments,
  };
}
