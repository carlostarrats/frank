#!/usr/bin/env node
// Looky Loo CLI entry point.
//
// Commands:
//   frank start   — inject hooks, start daemon, start panel
//   frank stop    — remove hooks, stop daemon
//   frank hook    — hook handler (called by Claude Code, reads stdin)

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

  case 'hook':
    await runHookHandler();
    break;

  default:
    console.log('Frank');
    console.log('');
    console.log('Usage:');
    console.log('  frank start   Start the daemon and inject Claude Code hooks');
    console.log('  frank stop    Stop the daemon and remove hooks');
    console.log('  frank hook    Hook handler (called automatically by Claude Code)');
    process.exit(0);
}

async function runStart(): Promise<void> {
  console.log('[frank] starting...');

  // Ensure schema temp dir exists
  fs.mkdirSync(SCHEMA_DIR, { recursive: true });

  const { injectClaudeMd, injectSettingsHook } = await import('./inject.js');
  injectClaudeMd();
  injectSettingsHook();

  const { startServer } = await import('./server.js');
  startServer();

  launchPanel();

  console.log('[frank] ready — open a new Claude Code session to begin');

  // Keep process alive
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
  const { removeClaudeMd, removeSettingsHook } = await import('./inject.js');
  removeClaudeMd();
  removeSettingsHook();
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

async function runHookHandler(): Promise<void> {
  const { runHook } = await import('./hook.js');
  await runHook();
  process.exit(0);
}
