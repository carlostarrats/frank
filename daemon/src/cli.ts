#!/usr/bin/env node
// Looky Loo CLI entry point.
//
// Commands:
//   lookyloo start   — inject hooks, start daemon, start panel
//   lookyloo stop    — remove hooks, stop daemon
//   lookyloo hook    — hook handler (called by Claude Code, reads stdin)

import fs from 'fs';
import { SCHEMA_DIR } from './protocol.js';

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
    console.log('Looky Loo');
    console.log('');
    console.log('Usage:');
    console.log('  lookyloo start   Start the daemon and inject Claude Code hooks');
    console.log('  lookyloo stop    Stop the daemon and remove hooks');
    console.log('  lookyloo hook    Hook handler (called automatically by Claude Code)');
    process.exit(0);
}

async function runStart(): Promise<void> {
  console.log('[lookyloo] starting...');

  // Ensure schema temp dir exists
  fs.mkdirSync(SCHEMA_DIR, { recursive: true });

  const { injectClaudeMd, injectSettingsHook } = await import('./inject.js');
  injectClaudeMd();
  injectSettingsHook();

  const { startServer } = await import('./server.js');
  startServer();

  console.log('[lookyloo] ready — open a new Claude Code session to begin');

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('\n[lookyloo] shutting down...');
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
  console.log('[lookyloo] stopped');
}

async function runHookHandler(): Promise<void> {
  const { runHook } = await import('./hook.js');
  await runHook();
  process.exit(0);
}
