// scaffold.js — "Spin One Up" entry. Pick a template, name the project,
// pick a target directory, watch the daemon copy/install/start the dev server,
// then land in the viewer on the detected URL.
//
// Two panels: the picker form, and the progress log. The log streams the
// daemon's scaffold-log messages until the scaffold-status goes 'ready'.

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

let streamHandler = null;

export function renderScaffold(container, { onBack, onOpenViewer, onScaffoldReady }) {
  container.innerHTML = `
    <div class="scaffold">
      <div class="scaffold-header">
        <button class="btn-ghost scaffold-back">← Back</button>
        <h2>Spin one up</h2>
        <div class="scaffold-sub">Scaffold a new project, let Frank start the dev server, and land in review mode.</div>
      </div>
      <div class="scaffold-body" id="scaffold-body"></div>
    </div>
  `;
  container.querySelector('.scaffold-back').addEventListener('click', onBack);

  const body = container.querySelector('#scaffold-body');
  body.innerHTML = '<div class="scaffold-loading">Loading templates…</div>';

  sync.listScaffoldTemplates().then((msg) => {
    renderPicker(body, msg.templates || [], { onOpenViewer, onScaffoldReady });
  }).catch((err) => {
    body.innerHTML = `<div class="scaffold-error">Could not load templates: ${escapeHtml(err.message || String(err))}</div>`;
  });
}

function renderPicker(body, templates, { onOpenViewer, onScaffoldReady }) {
  const defaultDir = `${getHomeDir()}/frank-projects`;
  body.innerHTML = `
    <div class="scaffold-pick">
      <h3>Choose a template</h3>
      <div class="scaffold-templates" id="scaffold-templates">
        ${templates.map((t) => `
          <label class="scaffold-template">
            <input type="radio" name="template" value="${escapeAttr(t.id)}">
            <div class="scaffold-template-body">
              <div class="scaffold-template-name">${escapeHtml(t.name)}</div>
              <div class="scaffold-template-desc">${escapeHtml(t.description)}</div>
              ${t.needsInstall ? `<div class="scaffold-template-meta">Install time: ~${t.estimatedInstallSeconds}s</div>` : '<div class="scaffold-template-meta">No install</div>'}
            </div>
          </label>
        `).join('')}
      </div>
      <div class="scaffold-form">
        <label>
          <span>Project name</span>
          <input type="text" id="scaffold-name" placeholder="My new project" autocomplete="off">
        </label>
        <label>
          <span>Install directory</span>
          <input type="text" id="scaffold-dir" value="${escapeAttr(defaultDir)}" autocomplete="off" spellcheck="false">
          <div class="scaffold-hint">Absolute path. Frank creates a subdirectory using a slug of the name.</div>
        </label>
        <button class="btn-primary" id="scaffold-submit" disabled>Scaffold</button>
        <div class="scaffold-form-error" id="scaffold-form-error"></div>
      </div>
    </div>
  `;

  const templateRadios = Array.from(body.querySelectorAll('input[name="template"]'));
  const nameInput = body.querySelector('#scaffold-name');
  const dirInput = body.querySelector('#scaffold-dir');
  const submit = body.querySelector('#scaffold-submit');
  const errEl = body.querySelector('#scaffold-form-error');

  const validate = () => {
    const hasTemplate = templateRadios.some((r) => r.checked);
    const hasName = nameInput.value.trim().length > 0;
    const hasDir = dirInput.value.trim().startsWith('/');
    submit.disabled = !(hasTemplate && hasName && hasDir);
  };
  templateRadios.forEach((r) => r.addEventListener('change', validate));
  nameInput.addEventListener('input', validate);
  dirInput.addEventListener('input', validate);

  submit.addEventListener('click', () => {
    const templateId = templateRadios.find((r) => r.checked)?.value;
    const name = nameInput.value.trim();
    const targetDir = dirInput.value.trim();
    errEl.textContent = '';
    if (!templateId || !name || !targetDir.startsWith('/')) {
      errEl.textContent = 'Fill in every field. Install directory must be an absolute path.';
      return;
    }
    startScaffold(body, { templateId, name, targetDir }, { onOpenViewer, onScaffoldReady });
  });
}

function startScaffold(body, { templateId, name, targetDir }, { onOpenViewer, onScaffoldReady }) {
  const state = {
    projectId: null,
    url: null,
    scaffoldPath: null,
    stage: 'pending',
    logs: [], // {stream, chunk}
  };

  body.innerHTML = `
    <div class="scaffold-progress">
      <div class="scaffold-progress-status" id="scaffold-stage">Starting…</div>
      <div class="scaffold-progress-sub" id="scaffold-sub"></div>
      <pre class="scaffold-log" id="scaffold-log"></pre>
      <div class="scaffold-actions" id="scaffold-actions" hidden></div>
    </div>
  `;
  const stageEl = body.querySelector('#scaffold-stage');
  const subEl = body.querySelector('#scaffold-sub');
  const logEl = body.querySelector('#scaffold-log');
  const actionsEl = body.querySelector('#scaffold-actions');

  const setStage = (label, sub = '') => {
    stageEl.textContent = label;
    subEl.textContent = sub;
  };

  // Subscribe to daemon push messages for the lifetime of this scaffold.
  if (streamHandler) sync.offMessage(streamHandler);
  streamHandler = (msg) => handleMessage(msg);
  sync.onMessage(streamHandler);

  function appendLog(chunk, stream) {
    state.logs.push({ stream, chunk });
    // Keep the log bounded; older lines drop off when it gets long.
    const maxLines = 500;
    logEl.textContent += chunk;
    const lines = logEl.textContent.split('\n');
    if (lines.length > maxLines) logEl.textContent = lines.slice(-maxLines).join('\n');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function handleMessage(msg) {
    if (msg.projectId && state.projectId && msg.projectId !== state.projectId) return;
    switch (msg.type) {
      case 'scaffold-status': {
        if (msg.projectId) state.projectId = msg.projectId;
        if (msg.scaffoldPath) state.scaffoldPath = msg.scaffoldPath;
        if (msg.url) state.url = msg.url;
        state.stage = msg.stage;
        if (msg.stage === 'created') setStage('Copying template files…', state.scaffoldPath || '');
        else if (msg.stage === 'installing') setStage('Installing dependencies…', 'This usually takes 30–60 seconds.');
        else if (msg.stage === 'starting') setStage('Starting dev server…');
        else if (msg.stage === 'ready') {
          setStage('Dev server ready', state.url || '');
          sync.offMessage(streamHandler);
          streamHandler = null;
          // Load the project and navigate to the viewer.
          sync.loadProject(state.projectId).then((data) => {
            projectManager.setFromLoaded({ ...data, projectId: state.projectId });
            if (onScaffoldReady) onScaffoldReady({ projectId: state.projectId, url: state.url });
            else if (onOpenViewer) onOpenViewer();
          });
        } else if (msg.stage === 'error') {
          setStage('Scaffold failed', msg.error || '');
          actionsEl.hidden = false;
          actionsEl.innerHTML = `
            <div class="scaffold-error">${escapeHtml(msg.error || 'unknown error')}</div>
            ${state.scaffoldPath ? `<p>Files are at <code>${escapeHtml(state.scaffoldPath)}</code>. You can cd there and run the install/dev commands manually.</p>` : ''}
          `;
        } else if (msg.stage === 'exited') {
          setStage('Dev server exited', msg.exitCode == null ? '' : `exit code ${msg.exitCode}`);
        }
        break;
      }
      case 'scaffold-log':
        appendLog(msg.chunk, msg.stream);
        break;
      case 'error':
        setStage('Error', msg.error || '');
        break;
    }
  }

  sync.scaffoldProject({ templateId, name, targetDir }).catch((err) => {
    setStage('Failed to submit scaffold request', err.message || String(err));
  });
}

function getHomeDir() {
  // Best-effort — browsers don't expose $HOME, so we ship a sane default that
  // lives under the user's home on macOS. Users can edit the field.
  return '/Users/you';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
