#!/usr/bin/env node
// Frank CLI entry point.
//
// Commands:
//   frank start   — inject CLAUDE.md, start daemon, launch panel
//   frank stop    — remove CLAUDE.md injection, stop daemon

import fs from 'fs';
import { execFile } from 'child_process';
import { SCHEMA_DIR, PANEL_APP_CANDIDATES } from './protocol.js';

const command = process.argv[2];

switch (command) {
  case 'start':
    await runStart();
    break;

  case 'stop':
    await runStop();
    break;

  default:
    console.log('Frank');
    console.log('');
    console.log('Usage:');
    console.log('  frank start   Start the daemon and inject Claude Code hooks');
    console.log('  frank stop    Stop the daemon and remove hooks');
    process.exit(0);
}

async function runStart(): Promise<void> {
  console.log('[frank] starting...');

  fs.mkdirSync(SCHEMA_DIR, { recursive: true });

  const { injectClaudeMd } = await import('./inject.js');
  injectClaudeMd();

  const { startServer } = await import('./server.js');
  startServer();

  launchPanel();

  console.log('[frank] ready — open a new Claude Code session to begin');

  process.on('SIGINT', async () => {
    console.log('\n[frank] shutting down...');
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

function launchPanel(): void {
  const appPath = PANEL_APP_CANDIDATES.find(p => fs.existsSync(p));
  if (!appPath) {
    console.warn('[frank] panel app not found — run: npm run tauri build');
    return;
  }
  execFile('open', [appPath], (err) => {
    if (err) console.warn('[frank] could not launch panel:', err.message);
    else console.log(`[frank] panel launched: ${appPath}`);
  });
}
