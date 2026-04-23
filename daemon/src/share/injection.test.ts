import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  detectLayoutFile,
  injectOverlayScript,
  renderOverlayScriptTag,
  prepareBundle,
} from './injection.js';

let tmp: string;

function write(rel: string, content: string) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-inject-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── Layout detection ─────────────────────────────────────────────────────

describe('detectLayoutFile — Next.js App Router', () => {
  it('detects app/layout.tsx when it contains <html> and <body>', () => {
    write(
      'app/layout.tsx',
      `export default function Root({children}) {
         return (<html lang="en"><body>{children}</body></html>);
       }`,
    );
    const result = detectLayoutFile(tmp, 'next-app');
    expect('path' in result).toBe(true);
    if ('path' in result) {
      expect(result.relPath).toBe('app/layout.tsx');
    }
  });

  it('detects src/app/layout.tsx when project uses src/ layout', () => {
    write(
      'src/app/layout.tsx',
      `<html><body>{children}</body></html>`,
    );
    const result = detectLayoutFile(tmp, 'next-app');
    if ('path' in result) {
      expect(result.relPath).toBe('src/app/layout.tsx');
    } else {
      throw new Error('expected detection to succeed');
    }
  });

  it('refuses when app/layout.tsx lacks <html>/<body>', () => {
    write('app/layout.tsx', `export default function Root({children}) { return children; }`);
    const result = detectLayoutFile(tmp, 'next-app');
    if ('code' in result) {
      expect(result.code).toBe('layout-missing-html-body');
    } else {
      throw new Error('expected refusal');
    }
  });

  it('refuses when no candidate exists', () => {
    const result = detectLayoutFile(tmp, 'next-app');
    if ('code' in result) {
      expect(result.code).toBe('layout-not-found');
    } else {
      throw new Error('expected refusal');
    }
  });
});

describe('detectLayoutFile — Next.js Pages Router', () => {
  it('detects pages/_document.tsx', () => {
    write('pages/_document.tsx', `// exists`);
    const result = detectLayoutFile(tmp, 'next-pages');
    if ('path' in result) {
      expect(result.relPath).toBe('pages/_document.tsx');
    } else throw new Error('expected detection');
  });

  it('refuses (does not create) missing _document.tsx', () => {
    const result = detectLayoutFile(tmp, 'next-pages');
    if ('code' in result) {
      expect(result.code).toBe('pages-document-missing');
    } else throw new Error('expected refusal');
  });
});

describe('detectLayoutFile — Vite', () => {
  it('detects index.html', () => {
    write('index.html', `<!doctype html><html><body><div id="root"></div></body></html>`);
    const result = detectLayoutFile(tmp, 'vite-react');
    if ('path' in result) {
      expect(result.relPath).toBe('index.html');
    } else throw new Error('expected detection');
  });
});

describe('detectLayoutFile — SvelteKit', () => {
  it('detects src/app.html when it has html/body', () => {
    write('src/app.html', `<html><body>%sveltekit.body%</body></html>`);
    const result = detectLayoutFile(tmp, 'sveltekit');
    if ('path' in result) {
      expect(result.relPath).toBe('src/app.html');
    } else throw new Error('expected detection');
  });
});

describe('detectLayoutFile — Astro', () => {
  it('detects first .astro layout with html/body', () => {
    write(
      'src/layouts/Base.astro',
      `<html><body><slot/></body></html>`,
    );
    const result = detectLayoutFile(tmp, 'astro');
    if ('path' in result) {
      expect(result.relPath).toBe('src/layouts/Base.astro');
    } else throw new Error('expected detection');
  });
});

describe('detectLayoutFile — Remix', () => {
  it('detects app/root.tsx', () => {
    write('app/root.tsx', `// exists`);
    const result = detectLayoutFile(tmp, 'remix');
    if ('path' in result) {
      expect(result.relPath).toBe('app/root.tsx');
    } else throw new Error('expected detection');
  });
});

// ─── Injection transform ─────────────────────────────────────────────────

describe('injectOverlayScript', () => {
  const opts = { shareId: 'abc-123', cloudUrl: 'https://cloud.example.com' };

  it('adds exactly one script tag before </body>', () => {
    const input = `<html><body><div>app</div></body></html>`;
    const { next, changed } = injectOverlayScript(input, opts);
    expect(changed).toBe(true);
    expect(next).toMatch(/<script[^>]+data-frank-share-overlay[^>]+><\/script>\s*<\/body>/);
    // exactly one tag
    const matches = next.match(/data-frank-share-overlay/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('escapes attribute values', () => {
    const { next } = injectOverlayScript('<html><body></body></html>', {
      shareId: 'a"b',
      cloudUrl: 'https://x.com',
    });
    expect(next).toContain('data-share-id="a&quot;b"');
  });

  it('is idempotent: re-running replaces the tag rather than stacking', () => {
    const input = `<html><body></body></html>`;
    const once = injectOverlayScript(input, opts);
    const twice = injectOverlayScript(once.next, opts);
    const matches = twice.next.match(/data-frank-share-overlay/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('updates attributes when share-id changes on re-injection', () => {
    const v1 = injectOverlayScript('<html><body></body></html>', { shareId: 'v1', cloudUrl: 'https://x' });
    const v2 = injectOverlayScript(v1.next, { shareId: 'v2', cloudUrl: 'https://x' });
    expect(v2.next).toContain('data-share-id="v2"');
    expect(v2.next).not.toContain('data-share-id="v1"');
  });

  it('appends when no </body> present (rare — layout validator should prevent)', () => {
    const input = `<html><div>no body</div></html>`;
    const { next, changed } = injectOverlayScript(input, opts);
    expect(changed).toBe(true);
    expect(next).toContain('data-frank-share-overlay');
  });
});

describe('renderOverlayScriptTag', () => {
  it('produces a well-formed tag', () => {
    const tag = renderOverlayScriptTag({ shareId: 'xyz', cloudUrl: 'https://c.example' });
    expect(tag).toContain('src="/frank-overlay.js"');
    expect(tag).toContain('data-share-id="xyz"');
    expect(tag).toContain('data-cloud-url="https://c.example"');
    expect(tag).toContain('async');
  });
});

// ─── prepareBundle (copy + inject + overlay asset) ───────────────────────

describe('prepareBundle', () => {
  it('copies allowlisted files, injects layout, writes overlay to public/ — leaves source untouched', async () => {
    // Source tree with a minimal Next.js App Router layout
    write(
      'app/layout.tsx',
      `export default function Root({ children }) {
         return (<html lang="en"><body>{children}</body></html>);
       }`,
    );
    write('app/page.tsx', `export default function Page() { return <div>hi</div>; }`);
    write('package.json', `{"name":"demo"}`);
    write('next.config.js', `/** @type {any} */ module.exports = {};`);

    const srcSnapshot = fs.readFileSync(path.join(tmp, 'app/layout.tsx'), 'utf-8');
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-bundle-'));
    try {
      const result = await prepareBundle({
        projectDir: tmp,
        framework: 'next-app',
        shareId: 'share-1',
        cloudUrl: 'https://cloud.test',
        files: [
          { relPath: 'app/layout.tsx', absPath: path.join(tmp, 'app/layout.tsx') },
          { relPath: 'app/page.tsx', absPath: path.join(tmp, 'app/page.tsx') },
          { relPath: 'package.json', absPath: path.join(tmp, 'package.json') },
          { relPath: 'next.config.js', absPath: path.join(tmp, 'next.config.js') },
        ],
        workingDir,
      });
      // Overlay asset exists in working copy's public/
      const overlayContent = fs.readFileSync(result.overlayDestPath, 'utf-8');
      expect(overlayContent).toContain('frank-overlay');
      // Layout was injected in the copy
      const copiedLayout = fs.readFileSync(path.join(workingDir, 'app/layout.tsx'), 'utf-8');
      expect(copiedLayout).toContain('data-frank-share-overlay');
      expect(copiedLayout).toContain('data-share-id="share-1"');
      expect(copiedLayout).toContain('data-cloud-url="https://cloud.test"');
      // Source was NOT modified
      const srcAfter = fs.readFileSync(path.join(tmp, 'app/layout.tsx'), 'utf-8');
      expect(srcAfter).toBe(srcSnapshot);
      // injectedLayout metadata is populated
      expect(result.injectedLayout?.relPath).toBe('app/layout.tsx');
    } finally {
      fs.rmSync(workingDir, { recursive: true, force: true });
    }
  });

  it('SvelteKit writes overlay to static/ not public/', async () => {
    write('src/app.html', `<html><body>%sveltekit.body%</body></html>`);
    write('package.json', `{"name":"sk"}`);
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-bundle-sk-'));
    try {
      const r = await prepareBundle({
        projectDir: tmp,
        framework: 'sveltekit',
        shareId: 's',
        cloudUrl: 'https://c',
        files: [
          { relPath: 'src/app.html', absPath: path.join(tmp, 'src/app.html') },
          { relPath: 'package.json', absPath: path.join(tmp, 'package.json') },
        ],
        workingDir,
      });
      expect(r.overlayDestPath.endsWith(path.join('static', 'frank-overlay.js'))).toBe(true);
      expect(fs.existsSync(r.overlayDestPath)).toBe(true);
    } finally {
      fs.rmSync(workingDir, { recursive: true, force: true });
    }
  });
});

describe('detectLayoutFile — static HTML', () => {
  it('detects root index.html', () => {
    write('index.html', '<!doctype html><html><head></head><body></body></html>');
    const r = detectLayoutFile(tmp, 'static-html');
    if ('code' in r) throw new Error(`unexpected failure: ${r.message}`);
    expect(r.relPath).toBe('index.html');
    expect(r.framework).toBe('static-html');
  });

  it('fails gracefully when index.html is absent', () => {
    write('about.html', '<html></html>');
    const r = detectLayoutFile(tmp, 'static-html');
    if (!('code' in r)) throw new Error('expected failure, got success');
    expect(r.code).toBe('layout-not-found');
  });
});

describe('prepareBundle — static HTML', () => {
  it('drops frank-overlay.js at the root (not in public/)', async () => {
    write('index.html', '<!doctype html><html><head></head><body></body></html>');
    write('style.css', 'body{}');
    const workingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-bundle-static-'));
    try {
      const r = await prepareBundle({
        projectDir: tmp,
        framework: 'static-html',
        shareId: 's1',
        cloudUrl: 'https://c',
        files: [
          { relPath: 'index.html', absPath: path.join(tmp, 'index.html') },
          { relPath: 'style.css', absPath: path.join(tmp, 'style.css') },
        ],
        workingDir,
      });
      // Overlay lives at <workingDir>/frank-overlay.js — NOT public/.
      expect(r.overlayDestPath).toBe(path.join(workingDir, 'frank-overlay.js'));
      expect(fs.existsSync(r.overlayDestPath)).toBe(true);
      expect(fs.existsSync(path.join(workingDir, 'public', 'frank-overlay.js'))).toBe(false);
      // Overlay script tag got injected into the copied index.html.
      const injected = fs.readFileSync(path.join(workingDir, 'index.html'), 'utf-8');
      expect(injected).toContain('data-frank-share-overlay');
      expect(injected).toContain('src="/frank-overlay.js"');
    } finally {
      fs.rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
