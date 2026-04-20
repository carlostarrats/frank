import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';
import type { Comment, ProjectV2 } from './protocol.js';
import { loadComments } from './projects.js';

export interface PdfLivePayload {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

function resolveSourcePath(projectId: string, file: string): string {
  // `file` in ProjectV2 is stored as e.g. "projects/<id>/source/<name>". Rebuild
  // the path from PROJECTS_DIR so we can't be tricked into reading files
  // outside the projects directory.
  const segments = file.split('/');
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

export async function buildPdfLivePayload(projectId: string): Promise<PdfLivePayload | null> {
  // Trust project.contentType === 'pdf'. The project's declared type is the
  // authoritative signal; file-extension sniffing would create false negatives
  // for legitimate PDFs stored as report.PDF, report (no extension), or files
  // renamed by the user. The v2 static-share iframe rendering is similarly
  // extension-agnostic — live share should match that permissiveness.
  const project = loadProjectJson(projectId);
  if (!project || project.contentType !== 'pdf' || !project.file) return null;

  const sourcePath = resolveSourcePath(projectId, project.file);
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;

  let bytes: Buffer;
  try { bytes = fs.readFileSync(sourcePath); } catch { return null; }

  const comments = loadComments(projectId);

  return {
    fileDataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`,
    mimeType: 'application/pdf',
    comments,
  };
}
