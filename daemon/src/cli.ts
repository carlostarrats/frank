#!/usr/bin/env node
// Frank CLI entry point.
//
// Commands:
//   frank start   — inject CLAUDE.md, start daemon, open browser
//   frank stop    — remove CLAUDE.md injection
//   frank connect — connect to Frank Cloud instance (Phase 2)
//   frank status  — show daemon and connection status (Phase 2)

import fs from 'fs';
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

  case 'connect':
    console.log('[frank] connect: coming in Phase 2 (cloud sharing)');
    console.log('[frank] usage: frank connect <cloud-url> --key <api-key>');
    process.exit(0);

  case 'status':
    console.log('[frank] status: coming in Phase 2');
    process.exit(0);

  default:
    console.log('Frank — collaboration layer for any web content');
    console.log('');
    console.log('Usage:');
    console.log('  frank start     Start Frank and open the browser');
    console.log('  frank stop      Stop Frank and remove Claude Code hooks');
    console.log('  frank connect   Connect to your Frank Cloud instance');
    console.log('  frank status    Show daemon and connection status');
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
