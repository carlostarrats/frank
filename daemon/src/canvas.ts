// Canvas state storage. One JSON blob per project at
// ~/.frank/projects/{projectId}/canvas-state.json. The daemon treats the
// payload as an opaque string — the shape is owned by the Konva client
// (stage.toJSON() / Konva.Node.create()).

import fs from 'fs';
import path from 'path';
import { PROJECTS_DIR } from './protocol.js';

function canvasStatePath(projectId: string): string {
  return path.join(PROJECTS_DIR, projectId, 'canvas-state.json');
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function loadCanvasState(projectId: string): string | null {
  const filePath = canvasStatePath(projectId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

export function saveCanvasState(projectId: string, state: string): void {
  // Validate it's at least well-formed JSON before writing. A corrupt state
  // file would hard-break the canvas view on load.
  JSON.parse(state);
  const dir = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Project directory does not exist: ${projectId}`);
  }
  atomicWrite(canvasStatePath(projectId), state);
}

export function deleteCanvasState(projectId: string): boolean {
  const filePath = canvasStatePath(projectId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
