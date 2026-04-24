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
import { fileURLToPath } from 'url';
import { FRANK_DIR, HTTP_PORT } from './protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_PATH = path.resolve(__dirname, '../package.json');
const CURRENT_VERSION = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version;
const PKG_NAME = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).name;

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

  case 'mcp': {
    // Run as an MCP stdio server. Intended to be spawned by an AI client
    // (Claude Desktop / Claude Code / Cursor / etc.), not run by a human at
    // the shell. Requires `frank start` to already be running — this
    // subprocess connects to that daemon over localhost WebSocket.
    const { runMcpServer } = await import('./mcp/server.js');
    await runMcpServer();
    break;
  }

  case 'share': {
    await runShare(process.argv.slice(3));
    break;
  }

  case 'uninstall':
    await runUninstall();
    break;

  default:
    console.log(`Frank v${CURRENT_VERSION} — a local-first collaboration layer`);
    console.log('');
    console.log('Usage:');
    console.log('  frank start       Start Frank and open the browser');
    console.log('  frank stop        Stop Frank and remove Claude Code hooks');
    console.log('  frank connect     Connect to your Frank Cloud instance');
    console.log('  frank status      Show daemon and connection status');
    console.log('  frank export      Export project data as structured JSON');
    console.log('  frank mcp         Run as an MCP stdio server (spawned by AI clients)');
    console.log('  frank share       Create / list / revoke URL-share deployments');
    console.log('  frank uninstall   Remove all Frank data and uninstall');
    process.exit(0);
}

async function runShare(args: string[]): Promise<void> {
  // frank share <dir>                → create (default verb)
  // frank share create <dir>         → explicit create
  // frank share list                 → list active shares (non-revoked, non-expired)
  // frank share revoke <shareId>     → revoke a share by cloud shareId
  //
  // All three verbs talk directly to the underlying modules — no running
  // daemon required. Reads Vercel + frank-cloud config from ~/.frank/
  // config.json; writes share records to ~/.frank/share-records.json so
  // they appear in a subsequent `frank start` popover too.
  const verb = args[0];
  if (!verb) {
    printShareUsage();
    process.exit(1);
  }

  // Treat `frank share <dir>` (positional path, no verb) as create.
  if (verb === 'create' || verb.startsWith('/') || verb.startsWith('~')) {
    const projectDir = verb === 'create' ? args[1] : verb;
    if (!projectDir) {
      printShareUsage();
      process.exit(1);
    }
    const expiryIdx = args.indexOf('--expiry');
    const expiryDays = expiryIdx >= 0 ? Number(args[expiryIdx + 1]) : undefined;
    if (expiryIdx >= 0 && (!Number.isFinite(expiryDays) || expiryDays! <= 0)) {
      console.error('[frank] --expiry requires a positive integer (days)');
      process.exit(1);
    }
    await shareCreateCli(path.resolve(projectDir), expiryDays);
    return;
  }

  if (verb === 'list') {
    const { listShareRecords } = await import('./share/share-records.js');
    const records = listShareRecords();
    if (records.length === 0) {
      console.log('[frank] no active shares');
      process.exit(0);
    }
    for (const r of records) {
      console.log(`  ${r.shareId}`);
      console.log(`    share link:   ${r.shareUrl}`);
      console.log(`    deployment:   ${r.deploymentUrl}`);
      console.log(`    project:      ${r.projectId} (${r.projectDir})`);
      console.log(`    expires:      ${r.expiresAt}`);
      console.log('');
    }
    process.exit(0);
  }

  if (verb === 'revoke') {
    const shareId = args[1];
    if (!shareId) {
      console.error('[frank] frank share revoke <shareId>');
      process.exit(1);
    }
    await shareRevokeCli(shareId);
    return;
  }

  printShareUsage();
  process.exit(1);
}

function printShareUsage(): void {
  console.log('Usage:');
  console.log('  frank share <dir> [--expiry <days>]    Create a URL-share from a local project directory');
  console.log('  frank share list                        List active (non-revoked, non-expired) shares');
  console.log('  frank share revoke <shareId>            Revoke a share — invalidates link + deletes Vercel deployment');
  console.log('');
  console.log('Requires Vercel deploy token + frank-cloud configured (Settings → Share Preview in the UI, or see docs).');
}

async function shareCreateCli(projectDir: string, expiryDays: number | undefined): Promise<void> {
  // Preconditions — mirror what the share-create WebSocket handler checks.
  const { getVercelDeployConfig, getCloudUrl, uploadUrlShareRecord } = await import('./cloud.js');
  const vercel = getVercelDeployConfig();
  if (!vercel) {
    console.error('[frank] Vercel deploy token not configured.');
    console.error('[frank] Run `frank start`, then Settings → Share Preview → paste a Vercel PAT.');
    process.exit(1);
  }
  const cloudUrl = getCloudUrl();
  if (!cloudUrl) {
    console.error('[frank] Frank-cloud not configured.');
    console.error('[frank] Run `frank connect <cloud-url> --key <api-key>` first.');
    process.exit(1);
  }
  if (!fs.existsSync(projectDir)) {
    console.error(`[frank] project directory not found: ${projectDir}`);
    process.exit(1);
  }

  const { createShare } = await import('./share/share-create.js');
  console.log(`[frank] sharing ${projectDir}`);
  const result = await createShare({
    projectDir,
    vercelToken: vercel.token,
    vercelTeamId: vercel.teamId,
    cloudUrl,
    onProgress: (info) => {
      const elapsed = info.elapsedMs ? ` (${Math.round(info.elapsedMs / 1000)}s)` : '';
      console.log(`[frank] ${info.stage}${elapsed}: ${info.message}`);
    },
  });

  if (result.status !== 'ok' || !result.deployment) {
    const stage = result.failure?.stage ?? 'unknown';
    const msg = result.failure?.message ?? 'Share creation failed.';
    console.error(`[frank] share failed at ${stage}: ${msg}`);
    process.exit(1);
  }

  // Persist to frank-cloud. Pass our own shareId so overlay + cloud agree.
  const cloudRecord = await uploadUrlShareRecord(
    {
      vercelId: result.deployment.id,
      vercelTeamId: vercel.teamId,
      url: result.deployment.url,
      readyState: result.deployment.readyState,
    },
    '',
    expiryDays,
    result.shareId,
  );
  if ('error' in cloudRecord) {
    console.error(`[frank] deployed OK but frank-cloud upload failed: ${cloudRecord.error}`);
    console.error(`[frank] the preview URL below still works; revoke manually via Vercel dashboard if needed.`);
    console.error(`[frank] deployment URL: ${result.deploymentUrl}`);
    process.exit(1);
  }

  // Write the share record so `frank share list` surfaces it. No projectId
  // — CLI shares aren't bound to a Frank project. Use a synthetic id so the
  // record schema stays populated; the UI's per-project filter will just
  // skip these.
  const { writeShareRecord } = await import('./share/share-records.js');
  try {
    writeShareRecord({
      shareId: cloudRecord.shareId,
      revokeToken: cloudRecord.revokeToken,
      vercelDeploymentId: result.deployment.id,
      vercelTeamId: vercel.teamId ?? undefined,
      deploymentUrl: result.deploymentUrl!,
      shareUrl: cloudRecord.url,
      projectId: `cli-share`,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ((expiryDays ?? 7) * 86400000)).toISOString(),
      projectDir,
      buildDirName: result.shareId,
    });
  } catch (err: any) {
    console.warn(`[frank] couldn't persist share record locally: ${err.message}`);
    console.warn(`[frank] (the share still works; just won't show in \`frank share list\`)`);
  }

  console.log('');
  console.log('[frank] share live');
  console.log(`  share link:   ${cloudRecord.url}`);
  console.log(`  deployment:   ${result.deploymentUrl}`);
  console.log(`  share id:     ${cloudRecord.shareId}`);
  console.log(`  revoke with:  frank share revoke ${cloudRecord.shareId}`);
  process.exit(0);
}

async function shareRevokeCli(shareId: string): Promise<void> {
  const { listShareRecords, markRecordRevoked, removeShareBuild } = await import('./share/share-records.js');
  const { getVercelDeployConfig, revokeShare: revokeCloudFlag } = await import('./cloud.js');
  const { revokeShare } = await import('./share/share-create.js');
  const { enqueueRevoke } = await import('./share/revoke-queue.js');

  // Look up the record so we have the revokeToken + Vercel deployment id.
  const record = listShareRecords({ includeRevoked: true, includeExpired: true })
    .find((r) => r.shareId === shareId);
  if (!record) {
    console.error(`[frank] no share record found for ${shareId}`);
    console.error(`[frank] list known shares with: frank share list`);
    process.exit(1);
  }
  if (record.revokedAt) {
    console.log(`[frank] ${shareId} already revoked at ${record.revokedAt}`);
    process.exit(0);
  }

  const vercel = getVercelDeployConfig();
  if (!vercel) {
    console.error('[frank] Vercel deploy token not configured; cannot delete the deployment.');
    process.exit(1);
  }

  console.log(`[frank] revoking ${shareId}...`);
  const result = await revokeShare({
    vercelToken: vercel.token,
    vercelTeamId: record.vercelTeamId ?? vercel.teamId,
    vercelDeploymentId: record.vercelDeploymentId,
    flipCloudFlag: () => revokeCloudFlag(shareId, record.revokeToken),
  });

  markRecordRevoked(shareId, {
    linkInvalidated: result.linkInvalidated,
    vercelDeleted: result.vercelDeleted,
    vercelError: result.vercelError,
    cloudError: result.cloudError,
  });
  try { removeShareBuild(record.buildDirName ?? shareId); } catch { /* best-effort */ }

  // Enqueue retry if Vercel delete failed but the link is dead.
  if (result.linkInvalidated && !result.vercelDeleted && result.vercelError) {
    enqueueRevoke({
      shareId,
      vercelDeploymentId: record.vercelDeploymentId,
      vercelTeamId: record.vercelTeamId,
      firstError: result.vercelError,
    });
    console.log(`[frank] link invalidated; Vercel delete failed — queued for retry`);
    console.log(`[frank] retries run while \`frank start\` is active.`);
    process.exit(0);
  }

  console.log(`[frank] revoke ${result.status === 'complete' ? 'complete' : 'partial'}`);
  console.log(`  link invalidated:   ${result.linkInvalidated}`);
  console.log(`  vercel deleted:     ${result.vercelDeleted}`);
  if (result.cloudError) console.log(`  cloud error:        ${result.cloudError}`);
  if (result.vercelError) console.log(`  vercel error:       ${result.vercelError}`);
  process.exit(result.status === 'complete' ? 0 : 1);
}

async function runStart(): Promise<void> {
  console.log('[frank] starting...');

  // Non-blocking update check
  checkForUpdate();

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

async function checkForUpdate(): Promise<void> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PKG_NAME}/latest`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;
    const data = await res.json() as { version: string };
    const latest = data.version;
    if (latest && latest !== CURRENT_VERSION) {
      console.log(`[frank] update available: ${CURRENT_VERSION} → ${latest}`);
      console.log(`[frank] run: npm update -g ${PKG_NAME}`);
    }
  } catch {
    // Silent fail — network might be unavailable
  }
}

async function runUninstall(): Promise<void> {
  const readline = await import('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const projectCount = fs.existsSync(path.join(FRANK_DIR, 'projects'))
    ? fs.readdirSync(path.join(FRANK_DIR, 'projects')).length
    : 0;

  console.log('[frank] this will permanently delete:');
  console.log(`  - All Frank data in ~/.frank/ (${projectCount} project${projectCount !== 1 ? 's' : ''}, snapshots, exports)`);
  console.log('  - Claude Code integration (CLAUDE.md injection)');
  console.log('  - The global frank command');
  console.log('');

  const answer = await new Promise<string>(resolve => {
    rl.question('[frank] type "delete everything" to confirm: ', resolve);
  });
  rl.close();

  if (answer.trim() !== 'delete everything') {
    console.log('[frank] uninstall cancelled');
    process.exit(0);
  }

  // Remove CLAUDE.md injection
  const { removeClaudeMd } = await import('./inject.js');
  removeClaudeMd();

  // Delete ~/.frank/
  if (fs.existsSync(FRANK_DIR)) {
    fs.rmSync(FRANK_DIR, { recursive: true, force: true });
    console.log('[frank] deleted ~/.frank/');
  }

  console.log('[frank] data removed. To finish uninstalling, run:');
  console.log('  npm uninstall -g frank-daemon');
  process.exit(0);
}

async function runStop(): Promise<void> {
  const { removeClaudeMd } = await import('./inject.js');
  removeClaudeMd();
  console.log('[frank] stopped');
}
