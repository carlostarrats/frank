#!/usr/bin/env node
// Frank CLI entry point.
//
// Commands:
//   frank start   — inject CLAUDE.md, start daemon, open browser
//   frank stop    — remove CLAUDE.md injection
//   frank connect — connect to Frank Cloud instance (Phase 2)
//   frank status  — show daemon and connection status (Phase 2)

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { FRANK_DIR, HTTP_PORT } from './protocol.js';

const command = process.argv[2];

switch (command) {
  case 'start':
    await runStart();
    break;

  case 'stop':
    await runStop();
    break;

  case 'connect': {
    const urlArg = process.argv[3];
    const keyFlag = process.argv.indexOf('--key');
    const keyArg = keyFlag >= 0 ? process.argv[keyFlag + 1] : undefined;

    if (!urlArg || !keyArg) {
      console.log('Usage: frank connect <cloud-url> --key <api-key>');
      console.log('Example: frank connect https://my-frank.vercel.app --key sk_abc123');
      process.exit(1);
    }

    const { saveCloudConfig, healthCheck } = await import('./cloud.js');
    saveCloudConfig(urlArg.replace(/\/$/, ''), keyArg);
    console.log(`[frank] saved cloud config`);

    const result = await healthCheck();
    if (result.ok) {
      console.log(`[frank] connected to ${urlArg}`);
    } else {
      console.error(`[frank] connection failed: ${result.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  case 'status': {
    const { isCloudConnected, getCloudUrl, healthCheck } = await import('./cloud.js');
    console.log('[frank] status');
    console.log(`  cloud: ${isCloudConnected() ? `connected (${getCloudUrl()})` : 'not connected'}`);
    if (isCloudConnected()) {
      const check = await healthCheck();
      console.log(`  health: ${check.ok ? 'ok' : check.error}`);
    }
    process.exit(0);
  }

  case 'export': {
    const projectArg = process.argv[3];
    if (!projectArg) {
      console.log('Usage: frank export <project-id>');
      console.log('Find project IDs with: ls ~/.frank/projects/');
      process.exit(1);
    }
    const { exportProject } = await import('./export.js');
    try {
      const data = exportProject(projectArg);
      const outPath = path.join(process.env.HOME || '', '.frank', 'exports', `${projectArg}-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`[frank] exported to ${outPath}`);
    } catch (e: any) {
      console.error(`[frank] export failed: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  default:
    console.log('Frank — collaboration layer for any web content');
    console.log('');
    console.log('Usage:');
    console.log('  frank start     Start Frank and open the browser');
    console.log('  frank stop      Stop Frank and remove Claude Code hooks');
    console.log('  frank connect   Connect to your Frank Cloud instance');
    console.log('  frank status    Show daemon and connection status');
    console.log('  frank export    Export project data as structured JSON');
    process.exit(0);
}

async function runStart(): Promise<void> {
  console.log('[frank] starting...');

  fs.mkdirSync(FRANK_DIR, { recursive: true });

  const { injectClaudeMd } = await import('./inject.js');
  injectClaudeMd();

  const { startServer } = await import('./server.js');
  startServer();

  const url = `http://localhost:${HTTP_PORT}`;
  execFile('open', [url], (err) => {
    if (err) console.warn('[frank] could not open browser:', err.message);
    else console.log(`[frank] opened ${url}`);
  });

  console.log('[frank] ready — open a project and start annotating');
  console.log('[frank] press Ctrl+C to stop');

  process.on('SIGINT', async () => {
    console.log('\n[frank] stopping...');
    await runStop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await runStop();
    process.exit(0);
  });
}

async function runStop(): Promise<void> {
  const { removeClaudeMd } = await import('./inject.js');
  removeClaudeMd();
  console.log('[frank] stopped');
}
