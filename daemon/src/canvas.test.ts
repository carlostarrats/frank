import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return tmpDir; },
  };
});

import { loadCanvasState, saveCanvasState, deleteCanvasState } from './canvas.js';

function setupProject(projectId: string) {
  fs.mkdirSync(path.join(tmpDir, projectId), { recursive: true });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-canvas-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('loadCanvasState', () => {
  it('returns null when the canvas state file does not exist', () => {
    setupProject('proj-empty');
    expect(loadCanvasState('proj-empty')).toBeNull();
  });

  it('returns null when the project directory does not exist', () => {
    expect(loadCanvasState('nonexistent-proj')).toBeNull();
  });

  it('returns the raw JSON string when the file exists', () => {
    setupProject('proj-1');
    const state = JSON.stringify({ attrs: {}, className: 'Stage', children: [] });
    fs.writeFileSync(path.join(tmpDir, 'proj-1', 'canvas-state.json'), state, 'utf8');
    expect(loadCanvasState('proj-1')).toBe(state);
  });
});

describe('saveCanvasState', () => {
  it('writes the state to canvas-state.json atomically', () => {
    setupProject('proj-save');
    const state = JSON.stringify({ attrs: {}, className: 'Stage', children: [{ className: 'Layer' }] });
    saveCanvasState('proj-save', state);
    const filePath = path.join(tmpDir, 'proj-save', 'canvas-state.json');
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(state);
  });

  it('overwrites an existing canvas state', () => {
    setupProject('proj-overwrite');
    saveCanvasState('proj-overwrite', JSON.stringify({ version: 1 }));
    saveCanvasState('proj-overwrite', JSON.stringify({ version: 2 }));
    const reloaded = loadCanvasState('proj-overwrite');
    expect(reloaded).toBe(JSON.stringify({ version: 2 }));
  });

  it('rejects invalid JSON without writing', () => {
    setupProject('proj-invalid');
    expect(() => saveCanvasState('proj-invalid', 'not{valid}json')).toThrow();
    expect(fs.existsSync(path.join(tmpDir, 'proj-invalid', 'canvas-state.json'))).toBe(false);
  });

  it('throws when the project directory does not exist', () => {
    expect(() => saveCanvasState('nonexistent-proj', '{}')).toThrow(/Project directory/);
  });

  it('does not leave .tmp files behind after a successful write', () => {
    setupProject('proj-tmp');
    saveCanvasState('proj-tmp', JSON.stringify({ ok: true }));
    const entries = fs.readdirSync(path.join(tmpDir, 'proj-tmp'));
    const tmpFiles = entries.filter(e => e.includes('.tmp.'));
    expect(tmpFiles).toHaveLength(0);
  });
});

describe('deleteCanvasState', () => {
  it('removes the canvas state file', () => {
    setupProject('proj-del');
    saveCanvasState('proj-del', JSON.stringify({ x: 1 }));
    expect(deleteCanvasState('proj-del')).toBe(true);
    expect(loadCanvasState('proj-del')).toBeNull();
  });

  it('returns false when no canvas state exists', () => {
    setupProject('proj-del-missing');
    expect(deleteCanvasState('proj-del-missing')).toBe(false);
  });
});

describe('canvas state round-trip', () => {
  it('preserves deeply nested Konva-shaped JSON', () => {
    setupProject('proj-rt');
    const state = JSON.stringify({
      attrs: { width: 1024, height: 768 },
      className: 'Stage',
      children: [
        {
          attrs: {},
          className: 'Layer',
          children: [
            { attrs: { x: 10, y: 20, width: 100, height: 80, fill: '#ffd' }, className: 'Rect' },
            { attrs: { x: 50, y: 60, text: 'Hello', fontSize: 16 }, className: 'Text' },
          ],
        },
      ],
    });
    saveCanvasState('proj-rt', state);
    expect(loadCanvasState('proj-rt')).toBe(state);
  });
});
