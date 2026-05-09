import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildBundle } from './bundler.js';

let tmp: string;

function touch(relPath: string, contents = 'x') {
  const full = path.join(tmp, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-share-bundle-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function relPaths(files: { relPath: string }[]): string[] {
  return files.map((f) => f.relPath).sort();
}

describe('buildBundle — Next.js App Router', () => {
  it('admits expected root files + app/ + public/', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('tsconfig.json', '{}');
    touch('app/layout.tsx', '');
    touch('app/page.tsx', '');
    touch('public/logo.svg', '');
    touch('components/Button.tsx', '');
    touch('lib/utils.ts', '');

    const result = await buildBundle(tmp, { framework: 'next-app' });
    expect(result.status).toBe('ok');
    const admitted = relPaths(result.files);
    expect(admitted).toContain('package.json');
    expect(admitted).toContain('package-lock.json');
    expect(admitted).toContain('next.config.js');
    expect(admitted).toContain('tsconfig.json');
    expect(admitted).toContain('app/layout.tsx');
    expect(admitted).toContain('app/page.tsx');
    expect(admitted).toContain('public/logo.svg');
    expect(admitted).toContain('components/Button.tsx');
    expect(admitted).toContain('lib/utils.ts');
  });

  it('refuses .env.local even at project root', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('.env.local', 'SECRET=value');

    const result = await buildBundle(tmp, { framework: 'next-app' });
    const envRejections = result.rejected.filter((r) => r.relPath === '.env.local');
    expect(envRejections).toHaveLength(1);
    expect(envRejections[0].reason).toBe('env-file-forbidden');
    expect(result.files.find((f) => f.relPath === '.env.local')).toBeUndefined();
  });

  it('refuses .env.production, .env.staging, .env.development', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    for (const f of ['.env', '.env.production', '.env.staging', '.env.development']) {
      touch(f, 'k=v');
    }
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('.env')).toBe(false);
    expect(admitted.has('.env.production')).toBe(false);
    expect(admitted.has('.env.staging')).toBe(false);
    expect(admitted.has('.env.development')).toBe(false);
  });

  it('admits exactly .env.share', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('.env.share', 'NEXT_PUBLIC_FRANK_SHARE=1');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    expect(result.files.map((f) => f.relPath)).toContain('.env.share');
  });

  it('refuses node_modules / .next / .git / test-results / .vercel', async () => {
    touch('package.json', '{}');
    touch('app/page.tsx', '');
    touch('node_modules/some/index.js', '');
    touch('.next/build-id', '');
    touch('.git/HEAD', '');
    touch('test-results/report.json', '');
    touch('.vercel/project.json', '');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect([...admitted].some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('.next/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('.git/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('test-results/'))).toBe(false);
    expect([...admitted].some((p) => p.startsWith('.vercel/'))).toBe(false);
  });

  it('refuses .pem keys outside public/', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('secrets/private.pem', '-----BEGIN-----\n-----END-----');
    touch('public/cert.pem', '-----BEGIN-----\n-----END-----');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    // secrets/ is refused because it's not in the allowlist at all.
    expect(result.rejected.find((r) => r.relPath === 'secrets')).toBeDefined();
  });

  it('admits root-level middleware.ts + proxy.ts + instrumentation.ts', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('middleware.ts', '');
    touch('proxy.ts', '');
    touch('instrumentation.ts', '');
    touch('instrumentation-client.ts', '');
    touch('sentry.server.config.ts', '');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('middleware.ts')).toBe(true);
    expect(admitted.has('proxy.ts')).toBe(true);
    expect(admitted.has('instrumentation.ts')).toBe(true);
    expect(admitted.has('instrumentation-client.ts')).toBe(true);
    expect(admitted.has('sentry.server.config.ts')).toBe(true);
  });

  it('refuses random unknown top-level files', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    touch('Dockerfile', 'FROM node');
    touch('README.md', '# readme');
    touch('random-script.sh', '#!/bin/bash');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('Dockerfile')).toBe(false);
    expect(admitted.has('README.md')).toBe(false);
    expect(admitted.has('random-script.sh')).toBe(false);
    expect(result.rejected.some((r) => r.relPath === 'Dockerfile' && r.reason === 'not-in-allowlist')).toBe(true);
  });

  it('refuses second lockfile', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('pnpm-lock.yaml', '');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    const result = await buildBundle(tmp, { framework: 'next-app' });
    const lockfilesAdmitted = result.files.filter((f) =>
      ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock'].includes(f.relPath),
    );
    expect(lockfilesAdmitted).toHaveLength(1);
  });
});

describe('buildBundle — Vite + React', () => {
  it('admits src/, not app/', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('vite.config.ts', '');
    touch('index.html', '<!doctype html><div id="root"></div>');
    touch('src/App.tsx', '');
    touch('src/main.tsx', '');
    touch('public/favicon.svg', '');
    touch('app/ignored.tsx', '');  // should be refused — not Next.js

    const result = await buildBundle(tmp, { framework: 'vite-react' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('src/App.tsx')).toBe(true);
    expect(admitted.has('src/main.tsx')).toBe(true);
    expect(admitted.has('index.html')).toBe(true);
    expect(admitted.has('public/favicon.svg')).toBe(true);
    expect(admitted.has('app/ignored.tsx')).toBe(false);
  });
});

describe('buildBundle — FastAPI + Jinja', () => {
  it('admits FastAPI/Jinja source, templates, static assets, and dependency files', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\njinja2==3.1.4\n');
    touch('pyproject.toml', '[project]\nname = "loca"\nversion = "0.1.0"\n');
    touch('uv.lock', 'version = 1\n');
    touch('poetry.lock', '[[package]]\nname = "fastapi"\n');
    touch('app/__init__.py', '');
    touch('app/config.py', 'DEBUG = False\n');
    touch('app/fake_db.py', 'rows = []\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/api/__init__.py', '');
    touch('app/api/router.py', 'from fastapi import APIRouter\nrouter = APIRouter()\n');
    touch('app/api/routes/auth.py', 'from fastapi import APIRouter\nrouter = APIRouter()\n');
    touch('app/models/__init__.py', '');
    touch('app/models/user.py', 'class User: pass\n');
    touch('app/services/__init__.py', '');
    touch('app/services/customer_service.py', 'def get_customer():\n    return None\n');
    touch('app/web/__init__.py', '');
    touch('app/web/router.py', 'from fastapi import APIRouter\nrouter = APIRouter()\n');
    touch('app/web/generate.py', 'def build():\n    return None\n');
    touch('app/web/routes/public.py', 'from fastapi import APIRouter\nrouter = APIRouter()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/templates/home.html', '<div>home</div>');
    touch('app/web/static/app.css', 'body {}');
    touch('app/web/static/app.js', 'console.log("hi")');

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    expect(result.status).toBe('ok');
    expect(relPaths(result.files)).toEqual([
      'app/__init__.py',
      'app/api/__init__.py',
      'app/api/router.py',
      'app/api/routes/auth.py',
      'app/config.py',
      'app/fake_db.py',
      'app/main.py',
      'app/models/__init__.py',
      'app/models/user.py',
      'app/services/__init__.py',
      'app/services/customer_service.py',
      'app/web/__init__.py',
      'app/web/generate.py',
      'app/web/router.py',
      'app/web/routes/public.py',
      'app/web/static/app.css',
      'app/web/static/app.js',
      'app/web/templates/home.html',
      'app/web/templates/partials/base.html',
      'poetry.lock',
      'pyproject.toml',
      'requirements.txt',
      'uv.lock',
    ]);
  });

  it('refuses .env.local for fastapi-jinja', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/static/app.css', 'body {}');
    touch('.env.local', 'SECRET=value');

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    const envRejections = result.rejected.filter((r) => r.relPath === '.env.local');
    expect(envRejections).toHaveLength(1);
    expect(envRejections[0].reason).toBe('env-file-forbidden');
    expect(result.files.find((f) => f.relPath === '.env.local')).toBeUndefined();
  });

  it('refuses nested .env.share files in fastapi-jinja templates', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/templates/.env.share', 'SHOULD_NOT_SHIP=1');
    touch('app/web/static/app.css', 'body {}');
    touch('.env.share', 'ROOT_ALLOWED=1');

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('.env.share')).toBe(true);
    expect(admitted.has('app/web/templates/.env.share')).toBe(false);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ relPath: 'app/web/templates/.env.share', reason: 'env-file-forbidden' }),
    ]));
  });

  it('refuses JS-era root files and public/ for fastapi-jinja', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/static/app.css', 'body {}');
    touch('package.json', '{}');
    touch('vite.config.ts', 'export default {};');
    touch('public/logo.svg', '<svg></svg>');

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('package.json')).toBe(false);
    expect(admitted.has('vite.config.ts')).toBe(false);
    expect([...admitted].some((p) => p.startsWith('public/'))).toBe(false);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ relPath: 'package.json', reason: 'not-in-allowlist' }),
      expect.objectContaining({ relPath: 'vite.config.ts', reason: 'not-in-allowlist' }),
      expect.objectContaining({ relPath: 'public', reason: 'not-in-allowlist' }),
    ]));
  });

  it('refuses JS lockfiles for fastapi-jinja', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/static/app.css', 'body {}');
    for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']) {
      touch(lockfile, '');
    }

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    for (const lockfile of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']) {
      expect(admitted.has(lockfile)).toBe(false);
      expect(result.rejected).toEqual(expect.arrayContaining([
        expect.objectContaining({ relPath: lockfile, reason: 'not-in-allowlist' }),
      ]));
    }
  });

  it('refuses nested secret-extension files in fastapi-jinja static subtree', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/static/app.css', 'body {}');
    touch('app/web/static/keys/private.pem', '-----BEGIN-----\n-----END-----');

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('app/web/static/keys/private.pem')).toBe(false);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ relPath: 'app/web/static/keys/private.pem', reason: 'secret-extension' }),
    ]));
  });

  it('refuses unwanted descendants under app/ for fastapi-jinja', async () => {
    touch('requirements.txt', 'fastapi==0.115.0\n');
    touch('app/main.py', 'from fastapi import FastAPI\napp = FastAPI()\n');
    touch('app/web/templates/partials/base.html', '<html></html>');
    touch('app/web/static/app.css', 'body {}');
    touch('app/dev.db', 'sqlite');
    touch('app/__pycache__/x.pyc', 'compiled');
    touch('app/tmp/note.txt', 'scratch');

    const result = await buildBundle(tmp, { framework: 'fastapi-jinja' });
    const admitted = new Set(result.files.map((f) => f.relPath));
    expect(admitted.has('app/dev.db')).toBe(false);
    expect(admitted.has('app/__pycache__/x.pyc')).toBe(false);
    expect(admitted.has('app/tmp/note.txt')).toBe(false);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ relPath: 'app/dev.db', reason: 'not-in-allowlist' }),
      expect.objectContaining({ relPath: 'app/__pycache__', reason: 'not-in-allowlist' }),
      expect.objectContaining({ relPath: 'app/tmp', reason: 'not-in-allowlist' }),
    ]));
  });
});

describe('buildBundle — size caps', () => {
  it('refuses single file over 50 MB', async () => {
    touch('package.json', '{}');
    touch('package-lock.json', '{}');
    touch('next.config.js', '');
    touch('app/page.tsx', '');
    // Create a 51 MB file
    const bigPath = path.join(tmp, 'public', 'big.bin');
    fs.mkdirSync(path.dirname(bigPath), { recursive: true });
    fs.writeFileSync(bigPath, Buffer.alloc(51 * 1024 * 1024));

    const result = await buildBundle(tmp, { framework: 'next-app' });
    const bigRejection = result.rejected.find((r) => r.relPath === 'public/big.bin');
    expect(bigRejection?.reason).toBe('over-size-cap');
    expect(result.files.find((f) => f.relPath === 'public/big.bin')).toBeUndefined();
  });
});

describe('buildBundle — static HTML (denylist path)', () => {
  it('admits every file in a simple static site', async () => {
    touch('index.html', '<!doctype html><html></html>');
    touch('about.html', '<!doctype html><html></html>');
    touch('style.css', 'body{}');
    touch('script.js', '//');
    touch('images/logo.png', 'PNG');
    touch('images/hero.webp', 'WEBP');
    touch('fonts/brand.woff2', 'WOFF2');
    touch('favicon.ico', 'ICO');
    touch('robots.txt', 'allow');
    touch('assets/resume.pdf', 'PDF');

    const result = await buildBundle(tmp, { framework: 'static-html' });
    expect(result.status).toBe('ok');
    const admitted = relPaths(result.files);
    expect(admitted).toContain('index.html');
    expect(admitted).toContain('about.html');
    expect(admitted).toContain('style.css');
    expect(admitted).toContain('script.js');
    expect(admitted).toContain('images/logo.png');
    expect(admitted).toContain('images/hero.webp');
    expect(admitted).toContain('fonts/brand.woff2');
    expect(admitted).toContain('favicon.ico');
    expect(admitted).toContain('robots.txt');
    expect(admitted).toContain('assets/resume.pdf');
  });

  it('refuses .env files even at the root', async () => {
    touch('index.html', '<!doctype html>');
    touch('.env', 'SECRET=hi');
    touch('.env.local', 'X=Y');
    touch('.env.share', 'OK=1');
    const result = await buildBundle(tmp, { framework: 'static-html' });
    const refused = result.rejected.map((r) => r.relPath);
    expect(refused).toContain('.env');
    expect(refused).toContain('.env.local');
    // Even .env.share is refused for static sites — no reason to ship any
    // env file when nothing on the server reads them.
    expect(refused).toContain('.env.share');
    expect(result.files.find((f) => f.relPath.startsWith('.env'))).toBeUndefined();
  });

  it('refuses .git, node_modules, build artefact dirs', async () => {
    touch('index.html', '<!doctype html>');
    touch('.git/HEAD', 'ref:');
    touch('node_modules/react/package.json', '{}');
    touch('dist/bundle.js', '/**/');
    const result = await buildBundle(tmp, { framework: 'static-html' });
    const admitted = relPaths(result.files);
    expect(admitted).toContain('index.html');
    expect(admitted.find((p) => p.startsWith('.git/'))).toBeUndefined();
    expect(admitted.find((p) => p.startsWith('node_modules/'))).toBeUndefined();
    expect(admitted.find((p) => p.startsWith('dist/'))).toBeUndefined();
  });

  it('refuses credential-extension files', async () => {
    touch('index.html', '<!doctype html>');
    touch('keys/server.pem', 'PRIV');
    touch('keys/id_rsa', 'SSH');
    touch('certs/api.crt', 'CERT');
    const result = await buildBundle(tmp, { framework: 'static-html' });
    const refused = result.rejected.map((r) => r.relPath);
    expect(refused).toContain('keys/server.pem');
    expect(refused).toContain('keys/id_rsa');
    expect(refused).toContain('certs/api.crt');
    expect(result.files.find((f) => f.relPath === 'keys/server.pem')).toBeUndefined();
  });

  it('refuses secret-ish filenames', async () => {
    touch('index.html', '<!doctype html>');
    touch('secrets.css', 'body{}');          // "secret" in name → refused
    touch('credentials.json', '{}');          // "credentials" in name → refused
    touch('private.js', '//');                // "private" in name → refused
    const result = await buildBundle(tmp, { framework: 'static-html' });
    const refused = result.rejected.map((r) => r.relPath);
    expect(refused).toContain('secrets.css');
    expect(refused).toContain('credentials.json');
    expect(refused).toContain('private.js');
  });
});
