import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { checkEnvelope, isEnginesNodeCompatible, parseMajorVersion } from './envelope.js';
import { parseEnvFile } from './env-share.js';

let tmp: string;

function writeJson(p: string, obj: unknown) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function writeFile(p: string, contents: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contents);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-share-env-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('parseMajorVersion', () => {
  it('extracts leading major from common specs', () => {
    expect(parseMajorVersion('^16.0.7')).toBe(16);
    expect(parseMajorVersion('16')).toBe(16);
    expect(parseMajorVersion('~15.1.0')).toBe(15);
    expect(parseMajorVersion('>=20.0.0')).toBe(20);
    expect(parseMajorVersion('latest')).toBe(null);
  });
});

describe('isEnginesNodeCompatible', () => {
  it('accepts explicit modern majors', () => {
    expect(isEnginesNodeCompatible('>=20.0.0')).toBe(true);
    expect(isEnginesNodeCompatible('^22.0.0')).toBe(true);
    expect(isEnginesNodeCompatible('18.x')).toBe(true);
    expect(isEnginesNodeCompatible('20')).toBe(true);
  });

  it('accepts open-ended floors that include modern versions', () => {
    expect(isEnginesNodeCompatible('>=16')).toBe(true);
    expect(isEnginesNodeCompatible('>=14.0.0')).toBe(true);
  });

  it('rejects pre-18 caps', () => {
    expect(isEnginesNodeCompatible('^14.0.0')).toBe(false);
    expect(isEnginesNodeCompatible('~16.0.0')).toBe(false);
    expect(isEnginesNodeCompatible('17')).toBe(false);
  });
});

describe('checkEnvelope — package.json', () => {
  it('fails fast when package.json is missing', async () => {
    const result = await checkEnvelope(tmp);
    expect(result.status).toBe('fail');
    expect(result.failures.map((f) => f.code)).toContain('no-package-json');
  });
});

describe('checkEnvelope — framework detection', () => {
  it('detects Next.js App Router when next + app/ exist', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'next build' },
      dependencies: { next: '^16.0.7', react: '^19.0.0', 'react-dom': '^19.0.0' },
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.framework?.id).toBe('next-app');
    expect(result.failures.filter((f) => f.code === 'framework-unsupported')).toHaveLength(0);
  });

  it('detects Next.js Pages Router when next + pages/ exist without app/', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'next build' },
      dependencies: { next: '^14.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
    });
    fs.mkdirSync(path.join(tmp, 'pages'));
    const result = await checkEnvelope(tmp);
    expect(result.framework?.id).toBe('next-pages');
  });

  it('detects Vite + React', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'vite build' },
      dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
      devDependencies: { vite: '^5.0.0', '@vitejs/plugin-react': '^4.0.0' },
    });
    const result = await checkEnvelope(tmp);
    expect(result.framework?.id).toBe('vite-react');
  });

  it('detects SvelteKit in preference to Vite+Svelte', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'vite build' },
      dependencies: { '@sveltejs/kit': '^2.0.0', svelte: '^4.0.0' },
      devDependencies: { vite: '^5.0.0' },
    });
    const result = await checkEnvelope(tmp);
    expect(result.framework?.id).toBe('sveltekit');
  });

  it('fails with framework-unsupported when no known framework detected', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'tsc' },
      dependencies: { typescript: '^5.0.0' },
    });
    const result = await checkEnvelope(tmp);
    expect(result.status).toBe('fail');
    expect(result.failures.map((f) => f.code)).toContain('framework-unsupported');
  });

  it('fails on Next.js major version outside [14, 15, 16]', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'next build' },
      dependencies: { next: '^13.0.0', react: '^18.0.0', 'react-dom': '^18.0.0' },
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('next-version-unsupported');
  });
});

describe('checkEnvelope — structural rules', () => {
  function nextAppPkg(extra: Record<string, unknown> = {}) {
    return {
      name: 'test',
      engines: { node: '>=20.0.0' },
      scripts: { build: 'next build' },
      dependencies: { next: '^16.0.7', react: '^19.0.0', 'react-dom': '^19.0.0' },
      ...extra,
    };
  }

  it('flags pnpm-workspace.yaml as monorepo-root', async () => {
    writeJson(path.join(tmp, 'package.json'), nextAppPkg());
    fs.mkdirSync(path.join(tmp, 'app'));
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('monorepo-root');
  });

  it('flags workspaces field in package.json', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      ...nextAppPkg(),
      workspaces: ['packages/*'],
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('monorepo-root');
  });

  it('flags workspace: protocol dep', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      ...nextAppPkg(),
      dependencies: {
        ...nextAppPkg().dependencies,
        '@repo/ui': 'workspace:*',
      },
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('workspace-protocol-dep');
  });

  it('flags git+ protocol dep', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      ...nextAppPkg(),
      dependencies: {
        ...nextAppPkg().dependencies,
        'private-lib': 'git+ssh://github.com/private/lib.git',
      },
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('git-protocol-dep');
  });

  it('fails when build script is missing', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      engines: { node: '>=20.0.0' },
      dependencies: { next: '^16.0.7', react: '^19.0.0', 'react-dom': '^19.0.0' },
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('no-build-script');
  });

  it('fails when engines.node is missing', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      name: 'test',
      scripts: { build: 'next build' },
      dependencies: { next: '^16.0.7', react: '^19.0.0', 'react-dom': '^19.0.0' },
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('no-engines-node');
  });

  it('fails engines.node ^16.0.0 as unsupported', async () => {
    writeJson(path.join(tmp, 'package.json'), {
      ...nextAppPkg({ engines: { node: '^16.0.0' } }),
    });
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('engines-node-unsupported');
  });

  it('flags private registry in .npmrc', async () => {
    writeJson(path.join(tmp, 'package.json'), nextAppPkg());
    fs.mkdirSync(path.join(tmp, 'app'));
    fs.writeFileSync(path.join(tmp, '.npmrc'), 'registry=https://internal.example.com/\n');
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).toContain('private-registry-dep');
  });

  it('does not flag npmjs-pointing .npmrc', async () => {
    writeJson(path.join(tmp, 'package.json'), nextAppPkg());
    fs.mkdirSync(path.join(tmp, 'app'));
    fs.writeFileSync(path.join(tmp, '.npmrc'), 'registry=https://registry.npmjs.org/\n');
    const result = await checkEnvelope(tmp);
    expect(result.failures.map((f) => f.code)).not.toContain('private-registry-dep');
  });

  it('passes a clean Next.js App Router project', async () => {
    writeJson(path.join(tmp, 'package.json'), nextAppPkg());
    fs.mkdirSync(path.join(tmp, 'app'));
    const result = await checkEnvelope(tmp);
    expect(result.status).toBe('pass');
    expect(result.failures).toHaveLength(0);
  });
});

describe('parseEnvFile', () => {
  it('parses KEY=VALUE lines', () => {
    const env = parseEnvFile('FOO=bar\nBAZ=qux\n');
    expect(env.FOO).toBe('bar');
    expect(env.BAZ).toBe('qux');
  });

  it('ignores comments and blank lines', () => {
    const env = parseEnvFile('# comment\n\nFOO=bar\n# another\n');
    expect(env.FOO).toBe('bar');
    expect(Object.keys(env)).toHaveLength(1);
  });

  it('strips matching quotes', () => {
    const env = parseEnvFile('A="double"\nB=\'single\'\nC=unquoted\n');
    expect(env.A).toBe('double');
    expect(env.B).toBe('single');
    expect(env.C).toBe('unquoted');
  });
});
