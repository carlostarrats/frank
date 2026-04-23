import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Redirect PROJECTS_DIR to a temp directory
let tmpDir: string;

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return tmpDir; },
    get FRANK_DIR() { return path.dirname(tmpDir); },
    get CONFIG_PATH() { return path.join(path.dirname(tmpDir), 'config.json'); },
  };
});

import {
  slugify,
  listProjects,
  loadProject,
  createProject,
  saveProject,
  deleteProject,
  addScreen,
  loadComments,
  addComment,
  deleteComment,
  mergeCloudComments,
  renameProject,
  setProjectSourceDir,
  archiveProject,
  unarchiveProject,
  trashProject,
  restoreProject,
  purgeExpiredTrash,
  TRASH_RETENTION_MS,
} from './projects.js';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-projects-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── slugify ────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('My Cool Project')).toBe('my-cool-project');
  });

  it('strips non-alphanumeric characters', () => {
    expect(slugify('Hello!!! World???')).toBe('hello-world');
  });

  it('strips leading and trailing hyphens', () => {
    expect(slugify('---leading---')).toBe('leading');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

// ─── createProject ──────────────────────────────────────────────────────────

describe('createProject', () => {
  it('creates a project with URL content type', () => {
    const { project, projectId } = createProject('Test Site', 'url', 'https://example.com');
    expect(project.frank_version).toBe('2');
    expect(project.name).toBe('Test Site');
    expect(project.contentType).toBe('url');
    expect(project.url).toBe('https://example.com');
    expect(project.file).toBeUndefined();
    expect(project.screens).toEqual({});
    expect(project.screenOrder).toEqual([]);
    expect(project.capture).toBe(true);
    expect(project.activeShare).toBeNull();
    expect(projectId).toMatch(/^test-site-[a-f0-9]{6}$/);
  });

  it('creates a project with PDF content type', () => {
    const { project } = createProject('My PDF', 'pdf', undefined, '/path/to/file.pdf');
    expect(project.contentType).toBe('pdf');
    expect(project.file).toBe('/path/to/file.pdf');
    expect(project.url).toBeUndefined();
  });

  it('creates project directory with project.json and comments.json', () => {
    const { projectId } = createProject('Dir Test', 'url', 'https://example.com');
    const dir = path.join(tmpDir, projectId);
    expect(fs.existsSync(path.join(dir, 'project.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'comments.json'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'snapshots'))).toBe(true);
  });

  it('initializes comments.json as empty array', () => {
    const { projectId } = createProject('Comments Init', 'url', 'https://example.com');
    const comments = JSON.parse(fs.readFileSync(path.join(tmpDir, projectId, 'comments.json'), 'utf8'));
    expect(comments).toEqual([]);
  });
});

// ─── loadProject ────────────────────────────────────────────────────────────

describe('loadProject', () => {
  it('loads a previously created project', () => {
    const { project: created, projectId } = createProject('Load Test', 'url', 'https://example.com');
    const loaded = loadProject(projectId);
    expect(loaded.name).toBe('Load Test');
    expect(loaded.url).toBe('https://example.com');
  });

  it('throws for nonexistent project', () => {
    expect(() => loadProject('nonexistent-abc123')).toThrow();
  });
});

// ─── saveProject ────────────────────────────────────────────────────────────

describe('saveProject', () => {
  it('updates the modified timestamp', () => {
    const { project, projectId } = createProject('Save Test', 'url', 'https://example.com');
    const originalModified = project.modified;

    // Small delay to ensure different timestamp
    project.name = 'Updated Name';
    saveProject(projectId, project);

    const reloaded = loadProject(projectId);
    expect(reloaded.name).toBe('Updated Name');
    expect(reloaded.modified >= originalModified).toBe(true);
  });
});

// ─── listProjects ───────────────────────────────────────────────────────────

describe('listProjects', () => {
  it('returns empty array when no projects exist', () => {
    expect(listProjects()).toEqual([]);
  });

  it('lists all created projects', () => {
    createProject('Project A', 'url', 'https://a.com');
    createProject('Project B', 'pdf', undefined, '/b.pdf');
    const list = listProjects();
    expect(list).toHaveLength(2);
    expect(list.map(p => p.name).sort()).toEqual(['Project A', 'Project B']);
  });

  it('includes comment counts', () => {
    const { projectId } = createProject('With Comments', 'url', 'https://x.com');
    addComment(projectId, {
      screenId: 'screen-1',
      anchor: { type: 'pin', x: 50, y: 50 },
      author: 'Alice',
      text: 'Test comment',
    });
    const list = listProjects();
    const found = list.find(p => p.projectId === projectId);
    expect(found?.commentCount).toBe(1);
  });

  it('sorts by modified descending', () => {
    const { project: projA, projectId: idA } = createProject('First', 'url', 'https://a.com');
    const { project: projB, projectId: idB } = createProject('Second', 'url', 'https://b.com');
    // Force different timestamps
    projA.modified = '2024-01-01T00:00:00.000Z';
    fs.writeFileSync(path.join(tmpDir, idA, 'project.json'), JSON.stringify(projA, null, 2));
    projB.modified = '2024-06-01T00:00:00.000Z';
    fs.writeFileSync(path.join(tmpDir, idB, 'project.json'), JSON.stringify(projB, null, 2));

    const list = listProjects();
    expect(list[0].projectId).toBe(idB);
    expect(list[1].projectId).toBe(idA);
  });

  it('skips directories without project.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'junk-dir'), { recursive: true });
    expect(listProjects()).toEqual([]);
  });
});

// ─── deleteProject ──────────────────────────────────────────────────────────

describe('deleteProject', () => {
  it('removes the project directory', () => {
    const { projectId } = createProject('To Delete', 'url', 'https://x.com');
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(true);
    deleteProject(projectId);
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(false);
  });

  it('does not throw for nonexistent project', () => {
    expect(() => deleteProject('nonexistent-abc123')).not.toThrow();
  });
});

// ─── addScreen ──────────────────────────────────────────────────────────────

describe('addScreen', () => {
  it('adds a screen to the project', () => {
    const { projectId } = createProject('Screen Test', 'url', 'https://x.com');
    const updated = addScreen(projectId, '/', 'Home');
    const screenIds = Object.keys(updated.screens);
    expect(screenIds).toHaveLength(1);
    expect(updated.screens[screenIds[0]]).toEqual({ route: '/', label: 'Home' });
    expect(updated.screenOrder).toEqual(screenIds);
  });

  it('adds multiple screens in order', () => {
    const { projectId } = createProject('Multi Screen', 'url', 'https://x.com');
    addScreen(projectId, '/', 'Home');
    const updated = addScreen(projectId, '/about', 'About');
    expect(updated.screenOrder).toHaveLength(2);
    expect(Object.values(updated.screens).map(s => s.label)).toContain('Home');
    expect(Object.values(updated.screens).map(s => s.label)).toContain('About');
  });
});

// ─── Comments ───────────────────────────────────────────────────────────────

describe('addComment', () => {
  it('creates a comment with id, ts, and pending status', () => {
    const { projectId } = createProject('Comment Test', 'url', 'https://x.com');
    const comment = addComment(projectId, {
      screenId: 'screen-1',
      anchor: { type: 'element', cssSelector: '#btn', domPath: '[0]', x: 10, y: 20 },
      author: 'Bob',
      text: 'Fix this button',
    });
    expect(comment.id).toMatch(/^c-\d+-[a-f0-9]{6}$/);
    expect(comment.ts).toBeTruthy();
    expect(comment.status).toBe('pending');
    expect(comment.text).toBe('Fix this button');
    expect(comment.author).toBe('Bob');
  });

  it('persists comment to disk', () => {
    const { projectId } = createProject('Persist Comment', 'url', 'https://x.com');
    addComment(projectId, {
      screenId: 'screen-1',
      anchor: { type: 'pin', x: 50, y: 50 },
      author: 'Alice',
      text: 'Hello',
    });
    const comments = loadComments(projectId);
    expect(comments).toHaveLength(1);
    expect(comments[0].text).toBe('Hello');
  });
});

describe('loadComments', () => {
  it('returns empty array for nonexistent comments file', () => {
    fs.mkdirSync(path.join(tmpDir, 'empty-project'), { recursive: true });
    expect(loadComments('empty-project')).toEqual([]);
  });
});

describe('deleteComment', () => {
  it('removes a comment by id', () => {
    const { projectId } = createProject('Delete Comment', 'url', 'https://x.com');
    const c1 = addComment(projectId, {
      screenId: 's1',
      anchor: { type: 'pin', x: 10, y: 10 },
      author: 'A',
      text: 'First',
    });
    addComment(projectId, {
      screenId: 's1',
      anchor: { type: 'pin', x: 20, y: 20 },
      author: 'B',
      text: 'Second',
    });
    const result = deleteComment(projectId, c1.id);
    expect(result).toBe(true);
    const remaining = loadComments(projectId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].text).toBe('Second');
  });

  it('returns false for nonexistent comment id', () => {
    const { projectId } = createProject('No Delete', 'url', 'https://x.com');
    expect(deleteComment(projectId, 'c-999-aaaaaa')).toBe(false);
  });
});

// ─── mergeCloudComments ─────────────────────────────────────────────────────

describe('mergeCloudComments', () => {
  it('merges new cloud comments into local', () => {
    const { projectId } = createProject('Merge Test', 'url', 'https://x.com');
    addComment(projectId, {
      screenId: 's1',
      anchor: { type: 'pin', x: 10, y: 10 },
      author: 'Local',
      text: 'Existing',
    });

    const result = mergeCloudComments(projectId, [
      { id: 'cloud-1', author: 'Reviewer', screenId: 's1', anchor: { type: 'pin', x: 30, y: 30 }, text: 'Cloud note', ts: new Date().toISOString() },
    ]);

    expect(result.newCount).toBe(1);
    expect(result.lastId).toBe('cloud-1');
    expect(loadComments(projectId)).toHaveLength(2);
  });

  it('deduplicates existing comment ids', () => {
    const { projectId } = createProject('Dedup Test', 'url', 'https://x.com');
    const existing = addComment(projectId, {
      screenId: 's1',
      anchor: { type: 'pin', x: 10, y: 10 },
      author: 'A',
      text: 'Existing',
    });

    const result = mergeCloudComments(projectId, [
      { id: existing.id, author: 'A', screenId: 's1', anchor: {}, text: 'Existing', ts: existing.ts },
    ]);

    expect(result.newCount).toBe(0);
    expect(loadComments(projectId)).toHaveLength(1);
  });

  it('returns null lastId for empty cloud comments', () => {
    const { projectId } = createProject('Empty Cloud', 'url', 'https://x.com');
    const result = mergeCloudComments(projectId, []);
    expect(result.lastId).toBeNull();
    expect(result.newCount).toBe(0);
  });
});

// ─── renameProject ──────────────────────────────────────────────────────────

describe('renameProject', () => {
  it('updates project name without moving the directory', () => {
    const { projectId } = createProject('Original Name', 'url', 'https://x.com');
    renameProject(projectId, 'Renamed');
    expect(loadProject(projectId).name).toBe('Renamed');
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(true);
  });

  it('trims whitespace', () => {
    const { projectId } = createProject('Trim Me', 'url', 'https://x.com');
    renameProject(projectId, '   Trimmed   ');
    expect(loadProject(projectId).name).toBe('Trimmed');
  });

  it('rejects empty names', () => {
    const { projectId } = createProject('Keep Me', 'url', 'https://x.com');
    expect(() => renameProject(projectId, '   ')).toThrow();
    expect(() => renameProject(projectId, '')).toThrow();
    expect(loadProject(projectId).name).toBe('Keep Me');
  });

  it('bumps modified timestamp', () => {
    const { project, projectId } = createProject('Bump Me', 'url', 'https://x.com');
    const before = project.modified;
    // Wait a millisecond so timestamps differ
    const after = new Date(Date.now() + 10).toISOString();
    const saved = { ...project, modified: before };
    fs.writeFileSync(path.join(tmpDir, projectId, 'project.json'), JSON.stringify(saved, null, 2));
    renameProject(projectId, 'Different');
    expect(loadProject(projectId).modified >= before).toBe(true);
  });
});

// ─── setProjectSourceDir ────────────────────────────────────────────────────

describe('setProjectSourceDir', () => {
  it('stores an absolute path on the project', () => {
    const { projectId } = createProject('src dir', 'url', 'http://localhost:3000');
    const updated = setProjectSourceDir(projectId, '/Users/test/app');
    expect(updated.sourceDir).toBe('/Users/test/app');
    expect(loadProject(projectId).sourceDir).toBe('/Users/test/app');
  });

  it('trims surrounding whitespace', () => {
    const { projectId } = createProject('trim', 'url', 'http://localhost:3000');
    const updated = setProjectSourceDir(projectId, '   /Users/test/app   ');
    expect(updated.sourceDir).toBe('/Users/test/app');
  });

  it('empty string clears the field', () => {
    const { projectId } = createProject('clear', 'url', 'http://localhost:3000');
    setProjectSourceDir(projectId, '/Users/test/app');
    const cleared = setProjectSourceDir(projectId, '');
    expect(cleared.sourceDir).toBeUndefined();
    expect(loadProject(projectId).sourceDir).toBeUndefined();
  });

  it('whitespace-only also clears the field', () => {
    const { projectId } = createProject('ws', 'url', 'http://localhost:3000');
    setProjectSourceDir(projectId, '/Users/test/app');
    const cleared = setProjectSourceDir(projectId, '   ');
    expect(cleared.sourceDir).toBeUndefined();
  });

  it('overwrites a previous value', () => {
    const { projectId } = createProject('overwrite', 'url', 'http://localhost:3000');
    setProjectSourceDir(projectId, '/Users/old/path');
    const updated = setProjectSourceDir(projectId, '/Users/new/path');
    expect(updated.sourceDir).toBe('/Users/new/path');
  });
});

// ─── archive / unarchive ────────────────────────────────────────────────────

describe('archiveProject / unarchiveProject', () => {
  it('sets archived timestamp', () => {
    const { projectId } = createProject('To Archive', 'url', 'https://x.com');
    archiveProject(projectId);
    const loaded = loadProject(projectId);
    expect(loaded.archived).toBeTruthy();
    expect(new Date(loaded.archived!).toString()).not.toBe('Invalid Date');
  });

  it('clears archived flag on unarchive', () => {
    const { projectId } = createProject('Restore Active', 'url', 'https://x.com');
    archiveProject(projectId);
    unarchiveProject(projectId);
    expect(loadProject(projectId).archived).toBeUndefined();
  });

  it('archived flag surfaces in listProjects summary', () => {
    const { projectId } = createProject('Listed Archived', 'url', 'https://x.com');
    archiveProject(projectId);
    const summary = listProjects().find(p => p.projectId === projectId);
    expect(summary?.archived).toBeTruthy();
  });
});

// ─── trash / restore / purge ────────────────────────────────────────────────

describe('trashProject / restoreProject', () => {
  it('soft-deletes: trashed timestamp set, directory preserved', () => {
    const { projectId } = createProject('Soft Delete', 'url', 'https://x.com');
    trashProject(projectId);
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(true);
    expect(loadProject(projectId).trashed).toBeTruthy();
  });

  it('restore clears trashed flag', () => {
    const { projectId } = createProject('Undo Trash', 'url', 'https://x.com');
    trashProject(projectId);
    restoreProject(projectId);
    expect(loadProject(projectId).trashed).toBeUndefined();
  });

  it('trashed flag surfaces in listProjects summary', () => {
    const { projectId } = createProject('Listed Trashed', 'url', 'https://x.com');
    trashProject(projectId);
    const summary = listProjects().find(p => p.projectId === projectId);
    expect(summary?.trashed).toBeTruthy();
  });
});

describe('purgeExpiredTrash', () => {
  it('removes trashed projects older than retention window', () => {
    const { projectId } = createProject('Old Trash', 'url', 'https://x.com');
    trashProject(projectId);
    // Backdate the trashed timestamp past the retention window
    const project = loadProject(projectId);
    project.trashed = new Date(Date.now() - TRASH_RETENTION_MS - 1000).toISOString();
    fs.writeFileSync(path.join(tmpDir, projectId, 'project.json'), JSON.stringify(project, null, 2));

    const purged = purgeExpiredTrash();
    expect(purged).toContain(projectId);
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(false);
  });

  it('leaves fresh trashed projects alone', () => {
    const { projectId } = createProject('Fresh Trash', 'url', 'https://x.com');
    trashProject(projectId);
    const purged = purgeExpiredTrash();
    expect(purged).not.toContain(projectId);
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(true);
  });

  it('ignores non-trashed projects entirely', () => {
    const { projectId } = createProject('Active', 'url', 'https://x.com');
    const purged = purgeExpiredTrash();
    expect(purged).not.toContain(projectId);
    expect(fs.existsSync(path.join(tmpDir, projectId))).toBe(true);
  });
});
