import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir: string;
let templatesDir: string;

vi.mock('./protocol.js', () => {
  const original = vi.importActual('./protocol.js') as any;
  return {
    ...original,
    get PROJECTS_DIR() { return path.join(tmpDir, 'projects'); },
  };
});

import {
  listTemplates,
  findTemplate,
  scaffoldProject,
} from './scaffold.js';

function makeTemplate(dir: string, id: string, files: Record<string, string>) {
  const root = path.join(dir, id);
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(root, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-test-scaffold-'));
  templatesDir = path.join(tmpDir, 'templates');
  fs.mkdirSync(templatesDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('listTemplates', () => {
  it('returns the known templates with required fields', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(2);
    const ids = templates.map((t) => t.id);
    expect(ids).toContain('static');
    expect(ids).toContain('vite-react');
    for (const t of templates) {
      expect(typeof t.name).toBe('string');
      expect(typeof t.description).toBe('string');
      expect(Array.isArray(t.devCommand)).toBe(true);
      expect(typeof t.needsInstall).toBe('boolean');
    }
  });
});

describe('findTemplate', () => {
  it('returns a template by id', () => {
    expect(findTemplate('static')?.id).toBe('static');
    expect(findTemplate('vite-react')?.id).toBe('vite-react');
  });

  it('returns null for an unknown id', () => {
    expect(findTemplate('not-a-template')).toBeNull();
  });
});

describe('scaffoldProject', () => {
  it('copies the template files into the target directory', () => {
    makeTemplate(templatesDir, 'static', {
      'index.html': '<!doctype html><title>hi</title>',
      'script.js': 'console.log(1);',
      'nested/file.txt': 'x',
    });
    const targetDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = scaffoldProject({
      templateId: 'static',
      name: 'My Site',
      targetDir,
      templatesDir,
    });
    expect(fs.existsSync(path.join(result.scaffoldPath, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(result.scaffoldPath, 'script.js'))).toBe(true);
    expect(fs.existsSync(path.join(result.scaffoldPath, 'nested', 'file.txt'))).toBe(true);
    expect(result.scaffoldPath).toBe(path.join(targetDir, 'my-site'));
  });

  it('creates a Frank project at ~/.frank/projects/{id}', () => {
    makeTemplate(templatesDir, 'static', { 'index.html': 'x' });
    const targetDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = scaffoldProject({ templateId: 'static', name: 'Test', targetDir, templatesDir });
    const projectJson = path.join(tmpDir, 'projects', result.projectId, 'project.json');
    expect(fs.existsSync(projectJson)).toBe(true);
    const project = JSON.parse(fs.readFileSync(projectJson, 'utf8'));
    expect(project.name).toBe('Test');
    expect(project.contentType).toBe('url');
    expect(project.scaffoldPath).toBe(result.scaffoldPath);
    expect(project.scaffoldTemplate).toBe('static');
  });

  it('rewrites package.json name to match the slug', () => {
    makeTemplate(templatesDir, 'static', {
      'package.json': '{"name":"starter","version":"0.1.0"}',
    });
    const targetDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(targetDir, { recursive: true });

    const result = scaffoldProject({ templateId: 'static', name: 'Marketing Page', targetDir, templatesDir });
    const pkg = JSON.parse(fs.readFileSync(path.join(result.scaffoldPath, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('marketing-page');
    expect(pkg.version).toBe('0.1.0');
  });

  it('refuses to scaffold into an existing directory', () => {
    makeTemplate(templatesDir, 'static', { 'index.html': 'x' });
    const targetDir = path.join(tmpDir, 'workspace');
    fs.mkdirSync(path.join(targetDir, 'existing'), { recursive: true });

    expect(() =>
      scaffoldProject({ templateId: 'static', name: 'existing', targetDir, templatesDir }),
    ).toThrow(/already exists/);
  });

  it('errors when the template id is unknown', () => {
    expect(() =>
      scaffoldProject({ templateId: 'not-real', name: 'x', targetDir: tmpDir, templatesDir }),
    ).toThrow(/Unknown template/);
  });

  it('errors when the template source files are missing', () => {
    // Don't create the template dir
    expect(() =>
      scaffoldProject({ templateId: 'static', name: 'x', targetDir: tmpDir, templatesDir }),
    ).toThrow(/Template files missing/);
  });

  it('errors when the name has no slug characters', () => {
    makeTemplate(templatesDir, 'static', { 'index.html': 'x' });
    expect(() =>
      scaffoldProject({ templateId: 'static', name: '---', targetDir: tmpDir, templatesDir }),
    ).toThrow(/empty or invalid/);
  });
});
