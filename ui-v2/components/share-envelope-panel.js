// share-envelope-panel.js — URL-share envelope diagnostics.
//
// Renders the refusal UI described in §1.1, §1.3, §1.4 of
// docs/url-share-auto-deploy-design.md. Step 2 scope: reusable display
// component + a minimal interactive harness that lets the user point Frank
// at a local directory and see the envelope verdict. The actual Share flow
// integration lands in a later step.

import sync from '../core/sync.js';

// Human-readable labels per failure code. Kept short so the refusal surface
// reads like a checklist, not an essay.
const FAILURE_TITLES = {
  'no-package-json': 'No package.json at project root',
  'framework-unsupported': 'Framework not supported at v1',
  'next-version-unsupported': 'Next.js major version not supported',
  'monorepo-root': 'Monorepo root',
  'workspace-protocol-dep': 'Workspace-protocol dependency',
  'no-build-script': 'Missing build script',
  'no-engines-node': 'Missing engines.node',
  'engines-node-unsupported': 'engines.node doesn’t overlap Vercel’s supported range',
  'private-registry-dep': 'Private npm registry configured',
  'git-protocol-dep': 'git+ / ssh: dependency',
  'source-too-large': 'Source would be too large',
  'sdk-missing-encoder-and-env-share': 'SDK needs .env.share coverage',
};

const REJECTION_REASON_COPY = {
  'env-file-forbidden': 'Real env file refused by design.',
  'secret-extension': 'Credential-extension file refused by design.',
  'denylist-dir': 'Excluded from upload.',
  'over-size-cap': 'Over the 50 MB per-file cap.',
  'not-in-allowlist': 'Not on Frank’s allowlist for this framework.',
};

/**
 * Render an envelope result + optional bundle summary into a container.
 * Container is emptied before render. Safe to call repeatedly.
 */
export function renderEnvelopeResult(container, { envelope, bundleSummary }) {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'share-envelope-result';

  // ── Verdict header ────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = `share-envelope-verdict share-envelope-verdict-${envelope.status}`;
  const verdictText = envelope.status === 'pass' ? 'Share envelope: PASS' : 'Share envelope: FAIL';
  header.innerHTML = `
    <div class="share-envelope-verdict-title">${verdictText}</div>
    <div class="share-envelope-verdict-sub">
      ${envelope.framework
        ? `Framework: <strong>${escapeHtml(envelope.framework.id)}</strong> ${escapeHtml(envelope.framework.versionSpec)}`
        : 'No supported framework detected.'}
    </div>
  `;
  root.appendChild(header);

  // ── Failures ──────────────────────────────────────────────────────
  if (envelope.failures.length > 0) {
    const section = document.createElement('section');
    section.className = 'share-envelope-section';
    section.innerHTML = `<h3>Blocking failures (${envelope.failures.length})</h3>`;
    const list = document.createElement('ul');
    list.className = 'share-envelope-failure-list';
    for (const f of envelope.failures) {
      const item = document.createElement('li');
      item.innerHTML = `
        <div class="share-envelope-failure-title">${escapeHtml(FAILURE_TITLES[f.code] ?? f.code)}</div>
        <div class="share-envelope-failure-message">${escapeHtml(f.message)}</div>
        ${f.hint ? `<div class="share-envelope-failure-hint">${escapeHtml(f.hint)}</div>` : ''}
      `;
      list.appendChild(item);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  // ── Warnings ──────────────────────────────────────────────────────
  if (envelope.warnings.length > 0) {
    const section = document.createElement('section');
    section.className = 'share-envelope-section';
    section.innerHTML = `<h3>Warnings (${envelope.warnings.length})</h3>`;
    const list = document.createElement('ul');
    list.className = 'share-envelope-warning-list';
    for (const w of envelope.warnings) {
      const item = document.createElement('li');
      item.innerHTML = `
        <div class="share-envelope-warning-message">${escapeHtml(w.message)}</div>
        ${w.hint ? `<div class="share-envelope-warning-hint">${escapeHtml(w.hint)}</div>` : ''}
      `;
      list.appendChild(item);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  // ── Detected SDKs ─────────────────────────────────────────────────
  if (envelope.detectedSdks.length > 0) {
    const section = document.createElement('section');
    section.className = 'share-envelope-section';
    section.innerHTML = `<h3>Detected SDKs (${envelope.detectedSdks.length})</h3>`;
    const list = document.createElement('ul');
    list.className = 'share-envelope-sdk-list';
    for (const sdk of envelope.detectedSdks) {
      const status = sdk.hasEncoder
        ? '<span class="share-envelope-sdk-badge share-envelope-sdk-badge-ok">encoder</span>'
        : sdk.hasEnvShareOverride
          ? '<span class="share-envelope-sdk-badge share-envelope-sdk-badge-override">.env.share</span>'
          : '<span class="share-envelope-sdk-badge share-envelope-sdk-badge-missing">needs coverage</span>';
      const item = document.createElement('li');
      item.innerHTML = `
        <span class="share-envelope-sdk-name">${escapeHtml(sdk.packageName)}</span>
        <span class="share-envelope-sdk-version">${escapeHtml(sdk.installedVersionSpec)}</span>
        ${status}
      `;
      list.appendChild(item);
    }
    section.appendChild(list);
    root.appendChild(section);
  }

  // ── Bundle summary ────────────────────────────────────────────────
  if (bundleSummary) {
    const section = document.createElement('section');
    section.className = 'share-envelope-section';
    section.innerHTML = `<h3>Bundle preview</h3>`;
    const body = document.createElement('div');
    body.className = 'share-envelope-bundle';
    body.innerHTML = `
      <div>Status: <strong>${bundleSummary.status}</strong></div>
      <div>Files to upload: ${bundleSummary.fileCount}</div>
      <div>Total size: ${formatBytes(bundleSummary.totalSize)}</div>
      <div>Refused files: ${bundleSummary.rejectedCount}</div>
    `;
    const rejectedList = document.createElement('ul');
    rejectedList.className = 'share-envelope-rejection-list';
    for (const [reason, count] of Object.entries(bundleSummary.rejectedByReason ?? {})) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="share-envelope-rejection-reason">${escapeHtml(reason)}</span>
        <span class="share-envelope-rejection-count">× ${count}</span>
        <span class="share-envelope-rejection-copy">${escapeHtml(REJECTION_REASON_COPY[reason] ?? '')}</span>
      `;
      rejectedList.appendChild(li);
    }
    body.appendChild(rejectedList);
    section.appendChild(body);
    root.appendChild(section);
  }

  container.appendChild(root);
}

/**
 * Mount the interactive diagnostics panel: directory input, check button,
 * result renderer. Returns a detach function.
 */
export function mountShareDiagnostics(container) {
  container.innerHTML = `
    <div class="share-diagnostics">
      <h2>Share envelope diagnostics</h2>
      <p class="share-diagnostics-hint">
        Point Frank at a local project directory. Frank will run envelope
        detection (framework, structural rules, refuse-to-guess) and report
        what would ship in the bundle. No network calls, no Vercel deploys.
      </p>
      <div class="share-vercel-config" id="share-vercel-config"></div>

      <form class="share-diagnostics-form" id="share-diagnostics-form">
        <label for="share-diagnostics-input">Absolute path to project</label>
        <input
          type="text"
          id="share-diagnostics-input"
          placeholder="/Users/you/code/my-app"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="share-diagnostics-buttons">
          <button type="submit" class="btn-primary" data-action="check">Check envelope</button>
          <button type="button" class="btn-secondary" data-action="preflight" disabled title="Run envelope check first">Run pre-flight (build + smoke)</button>
          <button type="button" class="btn-primary" data-action="create-share" disabled title="Run pre-flight first">Create share</button>
        </div>
      </form>
      <div class="share-diagnostics-status" id="share-diagnostics-status" aria-live="polite"></div>
      <div class="share-diagnostics-result" id="share-diagnostics-result"></div>
      <div class="share-diagnostics-preflight" id="share-diagnostics-preflight"></div>
      <div class="share-diagnostics-create" id="share-diagnostics-create"></div>
    </div>
  `;

  const form = container.querySelector('#share-diagnostics-form');
  const input = container.querySelector('#share-diagnostics-input');
  const status = container.querySelector('#share-diagnostics-status');
  const resultHost = container.querySelector('#share-diagnostics-result');
  const preflightHost = container.querySelector('#share-diagnostics-preflight');
  const preflightBtn = container.querySelector('[data-action="preflight"]');
  const createBtn = container.querySelector('[data-action="create-share"]');
  const createHost = container.querySelector('#share-diagnostics-create');
  const vercelConfigHost = container.querySelector('#share-vercel-config');

  let lastCheckedDir = null;
  let lastEnvelopeStatus = null;
  let lastPreflightReadiness = null;
  let vercelConfigured = false;

  function updatePreflightButton() {
    const canRun = lastCheckedDir && lastEnvelopeStatus === 'pass';
    preflightBtn.disabled = !canRun;
    preflightBtn.title = canRun
      ? 'Build + smoke the current project. Takes ~30s to several minutes.'
      : 'Run envelope check first — pre-flight only runs on envelopes that pass.';
  }

  function updateCreateButton() {
    const preflightOk = lastPreflightReadiness === 'green' || lastPreflightReadiness === 'yellow';
    const canCreate = lastCheckedDir && lastEnvelopeStatus === 'pass' && preflightOk && vercelConfigured;
    createBtn.disabled = !canCreate;
    if (!vercelConfigured) {
      createBtn.title = 'Configure a Vercel deploy token first (above).';
    } else if (!preflightOk) {
      createBtn.title = 'Run pre-flight first — Create share only runs on 🟢/🟡 results.';
    } else {
      createBtn.title = 'Deploy this project to Vercel as a preview share.';
    }
  }

  async function refreshVercelConfig() {
    try {
      const reply = await sync.getVercelDeployConfig();
      vercelConfigured = !!reply.configured;
      renderVercelConfig(vercelConfigHost, reply, refreshVercelConfig);
    } catch {
      vercelConfigured = false;
    }
    updateCreateButton();
  }
  refreshVercelConfig();

  async function runCheck(e) {
    e?.preventDefault?.();
    const projectDir = input.value.trim();
    if (!projectDir) {
      status.textContent = 'Enter a project path first.';
      return;
    }
    status.textContent = 'Checking envelope…';
    resultHost.innerHTML = '';
    preflightHost.innerHTML = '';
    createHost.innerHTML = '';
    lastCheckedDir = null;
    lastEnvelopeStatus = null;
    lastPreflightReadiness = null;
    updatePreflightButton();
    updateCreateButton();
    try {
      const reply = await sync.shareCheckEnvelope(projectDir);
      if (reply.type === 'error') {
        status.textContent = `Error: ${reply.error}`;
        return;
      }
      status.textContent = '';
      renderEnvelopeResult(resultHost, {
        envelope: reply.envelope,
        bundleSummary: reply.bundleSummary,
      });
      lastCheckedDir = projectDir;
      lastEnvelopeStatus = reply.envelope?.status ?? null;
      updatePreflightButton();
    } catch (err) {
      status.textContent = `Error: ${err?.message ?? String(err)}`;
    }
  }

  async function runPreflight() {
    if (!lastCheckedDir) return;
    const projectDir = lastCheckedDir;
    status.textContent = 'Running pre-flight build + smoke… this can take a few minutes.';
    preflightBtn.disabled = true;
    preflightHost.innerHTML = '<div class="share-envelope-preflight-pending">Pre-flight running — build, then 30s smoke window.</div>';
    try {
      const reply = await sync.sharePreflight(projectDir);
      if (reply.type === 'error') {
        status.textContent = `Error: ${reply.error}`;
        preflightHost.innerHTML = '';
        preflightBtn.disabled = false;
        return;
      }
      status.textContent = '';
      renderPreflightResult(preflightHost, reply.preflight);
      lastPreflightReadiness = reply.preflight?.smoke?.readiness ?? null;
    } catch (err) {
      status.textContent = `Error: ${err?.message ?? String(err)}`;
      preflightHost.innerHTML = '';
    } finally {
      updatePreflightButton();
      updateCreateButton();
    }
  }

  async function runCreateShare() {
    if (!lastCheckedDir) return;
    const projectDir = lastCheckedDir;
    status.textContent = 'Creating share — envelope, preflight, bundle, deploy. This can take a few minutes.';
    createHost.innerHTML = '<div class="share-envelope-preflight-pending">Creating share…</div>';
    createBtn.disabled = true;
    try {
      const reply = await sync.shareCreate(projectDir);
      if (reply.type === 'error') {
        status.textContent = `Error: ${reply.error}`;
        createHost.innerHTML = '';
        return;
      }
      status.textContent = '';
      renderShareCreateResult(createHost, reply, {
        onRevoke: async () => {
          if (reply.status !== 'ok' || !reply.shareId) return;
          createHost.innerHTML = '<div class="share-envelope-preflight-pending">Revoking…</div>';
          try {
            const r = await sync.shareRevokeUrl(
              reply.shareId,
              reply.revokeToken,
              reply.vercelDeploymentId,
            );
            renderShareCreateResult(createHost, reply, { revokeResult: r });
          } catch (err) {
            status.textContent = `Revoke error: ${err?.message ?? String(err)}`;
          }
        },
      });
    } catch (err) {
      status.textContent = `Error: ${err?.message ?? String(err)}`;
      createHost.innerHTML = '';
    } finally {
      updateCreateButton();
    }
  }

  form.addEventListener('submit', runCheck);
  preflightBtn.addEventListener('click', runPreflight);
  createBtn.addEventListener('click', runCreateShare);

  return () => {
    form.removeEventListener('submit', runCheck);
    preflightBtn.removeEventListener('click', runPreflight);
    createBtn.removeEventListener('click', runCreateShare);
  };
}

/**
 * Vercel deploy-token configuration block. Placed above the diagnostics form
 * so users see the "configure before sharing" requirement first.
 */
export function renderVercelConfig(container, cfg, onChange) {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'share-vercel-config-box';
  if (cfg.configured) {
    root.innerHTML = `
      <div class="share-envelope-verdict share-envelope-verdict-pass">
        <div class="share-envelope-verdict-title">Vercel deploy token: configured</div>
        <div class="share-envelope-verdict-sub">
          Team: ${escapeHtml(cfg.teamId || 'personal account')} · saved ${cfg.configuredAt ? new Date(cfg.configuredAt).toLocaleString() : 'at some point'}
        </div>
      </div>
      <div class="share-diagnostics-buttons">
        <button type="button" class="btn-secondary" data-action="replace-vercel">Replace token</button>
        <button type="button" class="btn-secondary" data-action="clear-vercel">Clear</button>
      </div>
    `;
    root.querySelector('[data-action="replace-vercel"]').addEventListener('click', () => showTokenForm(container, onChange));
    root.querySelector('[data-action="clear-vercel"]').addEventListener('click', async () => {
      await sync.clearVercelDeployConfig();
      onChange?.();
    });
  } else {
    showTokenForm(container, onChange);
    return;
  }
  container.appendChild(root);
}

function showTokenForm(container, onChange) {
  container.innerHTML = `
    <div class="share-envelope-verdict share-envelope-verdict-warn">
      <div class="share-envelope-verdict-title">Vercel deploy token required</div>
      <div class="share-envelope-verdict-sub">
        Paste a Vercel personal access token below. Note: Vercel's tokens are account-scoped — this token will have full access to whichever scope you choose.
        See <a href="https://vercel.com/account/tokens" target="_blank" rel="noopener">vercel.com/account/tokens</a>.
      </div>
    </div>
    <form class="share-vercel-token-form">
      <input type="password" placeholder="Vercel personal access token" class="share-vercel-token-input" autocomplete="off" spellcheck="false" />
      <input type="text" placeholder="Team ID (optional)" class="share-vercel-team-input" autocomplete="off" spellcheck="false" />
      <div class="share-diagnostics-buttons">
        <button type="submit" class="btn-primary">Save</button>
      </div>
    </form>
    <div class="share-vercel-status" aria-live="polite"></div>
  `;
  const form = container.querySelector('form');
  const tokenInput = container.querySelector('.share-vercel-token-input');
  const teamInput = container.querySelector('.share-vercel-team-input');
  const statusEl = container.querySelector('.share-vercel-status');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = tokenInput.value.trim();
    if (!token) {
      statusEl.textContent = 'Paste a token first.';
      return;
    }
    statusEl.textContent = 'Verifying token with Vercel…';
    const test = await sync.testVercelToken(token);
    if (!test.ok) {
      statusEl.textContent = `Verification failed: ${test.message ?? 'unknown error'}`;
      return;
    }
    await sync.setVercelDeployConfig(token, teamInput.value.trim() || undefined);
    statusEl.textContent = 'Saved.';
    tokenInput.value = '';
    onChange?.();
  });
}

/**
 * Render the share-create result: success shows the preview URL + revoke
 * button; failure shows the stage that broke + message.
 */
export function renderShareCreateResult(container, reply, hooks = {}) {
  container.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'share-envelope-preflight';
  if (reply.status === 'ok') {
    const verdict = document.createElement('div');
    verdict.className = 'share-envelope-verdict share-envelope-verdict-pass';
    verdict.innerHTML = `
      <div class="share-envelope-verdict-title">Share live</div>
      <div class="share-envelope-verdict-sub">
        Preview URL: <a href="${escapeHtml(reply.deploymentUrl)}" target="_blank" rel="noopener">${escapeHtml(reply.deploymentUrl)}</a><br/>
        Share ID: <code>${escapeHtml(reply.shareId)}</code>
      </div>
    `;
    root.appendChild(verdict);

    const revokeWrap = document.createElement('div');
    revokeWrap.className = 'share-diagnostics-buttons';
    if (hooks.revokeResult) {
      const r = hooks.revokeResult;
      const summary = document.createElement('div');
      summary.className = `share-envelope-verdict share-envelope-verdict-${r.status === 'complete' ? 'pass' : 'warn'}`;
      summary.innerHTML = `
        <div class="share-envelope-verdict-title">Revoke ${r.status === 'complete' ? 'complete' : 'partial'}</div>
        <div class="share-envelope-verdict-sub">
          Share link invalidated: ${r.linkInvalidated ? '✅' : '❌'}<br/>
          Vercel deployment deleted: ${r.vercelDeleted ? '✅' : '❌'}
          ${r.vercelError ? `<br/>Vercel error: ${escapeHtml(r.vercelError)}` : ''}
          ${r.cloudError ? `<br/>Cloud error: ${escapeHtml(r.cloudError)}` : ''}
        </div>
      `;
      root.appendChild(summary);
    } else if (hooks.onRevoke) {
      const btn = document.createElement('button');
      btn.className = 'btn-secondary';
      btn.textContent = 'Revoke share';
      btn.addEventListener('click', () => hooks.onRevoke());
      revokeWrap.appendChild(btn);
      root.appendChild(revokeWrap);
    }
  } else {
    const verdict = document.createElement('div');
    verdict.className = 'share-envelope-verdict share-envelope-verdict-fail';
    const stage = reply.failure?.stage ?? 'unknown';
    const message = reply.failure?.message ?? 'Share creation failed.';
    verdict.innerHTML = `
      <div class="share-envelope-verdict-title">Share creation failed at ${escapeHtml(stage)}</div>
      <div class="share-envelope-verdict-sub">${escapeHtml(message)}</div>
    `;
    root.appendChild(verdict);
  }
  container.appendChild(root);
}

/**
 * Render a preflight result into the given container. Null input means
 * preflight was skipped (envelope failed). Container is cleared first.
 */
export function renderPreflightResult(container, preflight) {
  container.innerHTML = '';
  if (!preflight) {
    const note = document.createElement('div');
    note.className = 'share-envelope-preflight-note';
    note.textContent = 'Pre-flight skipped (envelope did not pass).';
    container.appendChild(note);
    return;
  }

  const root = document.createElement('div');
  root.className = 'share-envelope-preflight';

  // Readiness header: green/yellow/red
  const readiness = preflight.smoke?.readiness ?? 'red';
  const header = document.createElement('div');
  header.className = `share-envelope-verdict share-envelope-verdict-${readiness === 'green' ? 'pass' : readiness === 'yellow' ? 'warn' : 'fail'}`;
  const title =
    readiness === 'green' ? 'Pre-flight: 🟢 green' :
    readiness === 'yellow' ? 'Pre-flight: 🟡 yellow (degradation detected)' :
    'Pre-flight: 🔴 red (blocked)';
  header.innerHTML = `
    <div class="share-envelope-verdict-title">${title}</div>
    <div class="share-envelope-verdict-sub">
      Build ${preflight.build.status} in ${(preflight.build.durationMs / 1000).toFixed(1)}s
      ${preflight.smoke ? `· smoke ${preflight.smoke.status} · ${preflight.smoke.errorLineCount} error line${preflight.smoke.errorLineCount === 1 ? '' : 's'}` : ''}
    </div>
  `;
  root.appendChild(header);

  // Build section
  const buildSection = document.createElement('section');
  buildSection.className = 'share-envelope-section';
  buildSection.innerHTML = `
    <h3>Build</h3>
    <div class="share-envelope-bundle">
      <div>Status: <strong>${escapeHtml(preflight.build.status)}</strong></div>
      <div>Exit code: ${preflight.build.exitCode ?? '(killed)'}</div>
      <div>Duration: ${(preflight.build.durationMs / 1000).toFixed(1)}s</div>
    </div>
  `;
  if (preflight.build.status === 'fail' && preflight.build.stderrTail) {
    const pre = document.createElement('pre');
    pre.className = 'share-envelope-log';
    pre.textContent = preflight.build.stderrTail;
    buildSection.appendChild(pre);
  }
  root.appendChild(buildSection);

  // Smoke section
  if (preflight.smoke) {
    const smokeSection = document.createElement('section');
    smokeSection.className = 'share-envelope-section';
    smokeSection.innerHTML = `<h3>Smoke</h3>`;
    const body = document.createElement('div');
    body.className = 'share-envelope-bundle';
    body.innerHTML = `
      <div>Status: <strong>${escapeHtml(preflight.smoke.status)}</strong> (readiness: ${escapeHtml(preflight.smoke.readiness)})</div>
      <div>Port: ${preflight.smoke.port ?? '—'}</div>
      <div>Server startup: ${preflight.smoke.startupMs}ms</div>
      <div>Fallback routes used: ${preflight.smoke.usedFallbackRoutes ? 'yes' : 'no'}</div>
      <div>Error lines in 30s tail: ${preflight.smoke.errorLineCount}</div>
    `;
    smokeSection.appendChild(body);

    if (preflight.smoke.routes?.length) {
      const list = document.createElement('ul');
      list.className = 'share-envelope-route-list';
      for (const r of preflight.smoke.routes) {
        const li = document.createElement('li');
        const statusLabel = r.httpStatus != null ? `HTTP ${r.httpStatus}` : `err: ${r.error ?? 'unknown'}`;
        li.innerHTML = `
          <span class="share-envelope-route-path">${escapeHtml(r.pathname)}</span>
          <span class="share-envelope-route-status">${escapeHtml(statusLabel)}</span>
        `;
        list.appendChild(li);
      }
      smokeSection.appendChild(list);
    }

    if (preflight.smoke.errorSamples?.length) {
      const pre = document.createElement('pre');
      pre.className = 'share-envelope-log';
      pre.textContent = preflight.smoke.errorSamples.join('\n');
      smokeSection.appendChild(pre);
    }
    root.appendChild(smokeSection);
  }

  container.appendChild(root);
}

// ── helpers ──────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes) {
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
