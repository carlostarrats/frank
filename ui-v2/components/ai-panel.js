// ai-panel.js — persistent AI conversation panel docked in the viewer.
//
// Talks to the daemon's Claude provider. Streams responses into the active
// assistant bubble as deltas arrive. Persists every turn through the daemon,
// so refresh/navigation resumes where the user left off.
//
// Clipboard fallback — "Copy as prompt" — still lives on each user message
// via ai-routing.js, so users of non-Claude providers are not left out.

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

const state = {
  host: null,
  open: false,
  configured: false,
  conversationId: null,      // null → create on first send
  continuedFromId: null,
  messages: [],              // { role, content, ts, streaming? }
  streamingConversationId: null,
  sending: false,
  capWarned: false,
  capFull: false,
};

let streamHandler = null;

export function mountAiPanel(host) {
  state.host = host;
  host.innerHTML = `
    <div class="ai-panel">
      <div class="ai-panel-header">
        <button class="ai-panel-toggle" id="ai-panel-close" title="Close">×</button>
        <div class="ai-panel-title">Ask Claude</div>
        <button class="ai-panel-action" id="ai-panel-new" title="New conversation">＋</button>
        <button class="ai-panel-action" id="ai-panel-settings" title="Settings">⚙</button>
      </div>
      <div class="ai-panel-warning" id="ai-panel-warning" hidden></div>
      <div class="ai-panel-messages" id="ai-panel-messages"></div>
      <form class="ai-panel-composer" id="ai-panel-composer">
        <textarea
          class="ai-panel-input"
          id="ai-panel-input"
          placeholder="Ask about this project…"
          rows="2"
        ></textarea>
        <button type="submit" class="ai-panel-send" id="ai-panel-send">Send</button>
      </form>
      <div class="ai-panel-footer" id="ai-panel-footer"></div>
    </div>
  `;

  host.querySelector('#ai-panel-close').addEventListener('click', () => closeAiPanel());
  host.querySelector('#ai-panel-new').addEventListener('click', () => newConversation());
  host.querySelector('#ai-panel-settings').addEventListener('click', () => openSettings());

  const composer = host.querySelector('#ai-panel-composer');
  const input = host.querySelector('#ai-panel-input');
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    sendCurrentInput();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendCurrentInput();
    }
  });

  // Subscribe once to daemon stream events for this page lifetime
  if (!streamHandler) {
    streamHandler = (msg) => handleDaemonMessage(msg);
    sync.onMessage(streamHandler);
  }
}

export function openAiPanel() {
  if (!state.host) return;
  state.open = true;
  state.host.classList.add('open');
  // Refresh configured status and pick up the most recent conversation
  refreshConfig();
  loadMostRecentConversation();
  state.host.querySelector('#ai-panel-input')?.focus();
}

export function closeAiPanel() {
  if (!state.host) return;
  state.open = false;
  state.host.classList.remove('open');
}

export function toggleAiPanel() {
  if (state.open) closeAiPanel();
  else openAiPanel();
}

async function refreshConfig() {
  try {
    const msg = await sync.getAiConfig();
    state.configured = !!msg.providers?.claude?.configured;
    updateFooter();
  } catch (err) {
    console.warn('[ai-panel] config load failed:', err);
  }
}

async function loadMostRecentConversation() {
  try {
    const msg = await sync.listAiConversations();
    const list = msg.conversations || [];
    // Prefer the most recent non-capped conversation; fall through to the most
    // recent capped one so the user can see their history.
    const active = list.find((c) => !c.capReached) || list[0];
    if (!active) {
      resetLocalConversation();
      return;
    }
    const loaded = await sync.loadAiConversation(active.id);
    state.conversationId = loaded.conversation.id;
    state.continuedFromId = loaded.conversation.continuedFrom;
    state.messages = loaded.conversation.messages.slice();
    state.capFull = !!loaded.conversation.capReached;
    state.capWarned = state.capFull;
    renderMessages();
    renderCapBanner();
  } catch (err) {
    console.warn('[ai-panel] could not load conversations:', err);
    resetLocalConversation();
  }
}

function resetLocalConversation() {
  state.conversationId = null;
  state.continuedFromId = null;
  state.messages = [];
  state.capFull = false;
  state.capWarned = false;
  renderMessages();
  renderCapBanner();
}

function newConversation() {
  const priorId = state.conversationId;
  resetLocalConversation();
  state.continuedFromId = priorId;
  renderCapBanner();
}

async function sendCurrentInput() {
  if (state.sending) return;
  const input = state.host.querySelector('#ai-panel-input');
  const message = input.value.trim();
  if (!message) return;
  if (!state.configured) {
    openSettings();
    return;
  }
  if (state.capFull) {
    // Automatic continuation: start a new conversation that links back.
    newConversation();
  }

  input.value = '';
  state.sending = true;
  state.messages.push({ role: 'user', content: message, ts: new Date().toISOString() });
  state.messages.push({ role: 'assistant', content: '', ts: new Date().toISOString(), streaming: true });
  renderMessages();

  try {
    await sync.sendAiMessage({
      conversationId: state.conversationId,
      continuedFrom: state.continuedFromId,
      message,
    });
  } catch (err) {
    console.warn('[ai-panel] send failed:', err);
    state.sending = false;
    const last = state.messages[state.messages.length - 1];
    if (last && last.streaming) {
      last.streaming = false;
      last.content = `Error: ${err.message || err}`;
    }
    renderMessages();
  }
}

function handleDaemonMessage(msg) {
  switch (msg.type) {
    case 'ai-stream-started':
      state.conversationId = msg.conversationId;
      state.streamingConversationId = msg.conversationId;
      updateFooter(`Streaming from ${msg.model} · ~${msg.contextTokens} context tokens`);
      break;
    case 'ai-stream-delta': {
      if (msg.conversationId !== state.conversationId) return;
      const last = state.messages[state.messages.length - 1];
      if (last && last.streaming) {
        last.content += msg.delta;
        renderMessages({ append: true });
      }
      break;
    }
    case 'ai-stream-ended': {
      if (msg.conversationId !== state.conversationId) return;
      const last = state.messages[state.messages.length - 1];
      if (last && last.streaming) {
        last.streaming = false;
        last.content = msg.fullText;
      }
      state.streamingConversationId = null;
      state.sending = false;
      state.capFull = !!msg.capStatus?.hardCap;
      state.capWarned = !!msg.capStatus?.softWarn;
      renderMessages();
      renderCapBanner();
      updateFooter();
      break;
    }
    case 'ai-stream-error': {
      const last = state.messages[state.messages.length - 1];
      if (last && last.streaming) {
        last.streaming = false;
        last.content = `Error: ${msg.error}`;
      }
      state.streamingConversationId = null;
      state.sending = false;
      renderMessages();
      updateFooter();
      break;
    }
    case 'conversation-full': {
      state.capFull = true;
      renderCapBanner();
      break;
    }
  }
}

function renderMessages(opts = {}) {
  const list = state.host.querySelector('#ai-panel-messages');
  if (!list) return;
  if (opts.append) {
    // Fast path: only update the last (streaming) bubble's text content.
    const last = state.messages[state.messages.length - 1];
    const bubbles = list.querySelectorAll('.ai-bubble');
    const lastBubble = bubbles[bubbles.length - 1];
    if (last && lastBubble) {
      const textEl = lastBubble.querySelector('.ai-bubble-text');
      if (textEl) textEl.textContent = last.content;
      list.scrollTop = list.scrollHeight;
      return;
    }
  }
  if (state.messages.length === 0) {
    list.innerHTML = `
      <div class="ai-panel-empty">
        <p>Ask anything about this project.</p>
        <p class="ai-panel-empty-hint">Claude sees your curated comments, recent snapshots, and (for canvas projects) the canvas state.</p>
      </div>
    `;
    return;
  }
  list.innerHTML = state.messages.map((m, i) => {
    const cls = `ai-bubble ai-bubble-${m.role}${m.streaming ? ' streaming' : ''}`;
    const body = m.streaming && !m.content ? '<span class="ai-bubble-cursor">▋</span>' : escapeHtml(m.content);
    return `
      <div class="${cls}">
        <div class="ai-bubble-role">${m.role === 'user' ? 'You' : 'Claude'}</div>
        <div class="ai-bubble-text">${body}</div>
        ${m.role === 'user' ? `<button class="ai-bubble-copy" data-idx="${i}" title="Copy as prompt for another AI">Copy</button>` : ''}
      </div>
    `;
  }).join('');
  list.scrollTop = list.scrollHeight;

  list.querySelectorAll('.ai-bubble-copy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const msg = state.messages[idx];
      if (!msg) return;
      navigator.clipboard?.writeText(msg.content).catch(() => {});
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
  });
}

function renderCapBanner() {
  const banner = state.host.querySelector('#ai-panel-warning');
  if (!banner) return;
  if (state.capFull) {
    banner.hidden = false;
    banner.className = 'ai-panel-warning ai-panel-warning-hard';
    banner.textContent = 'This conversation is full. Sending will start a new one linked to this history.';
    return;
  }
  if (state.capWarned) {
    banner.hidden = false;
    banner.className = 'ai-panel-warning ai-panel-warning-soft';
    banner.textContent = 'This conversation is getting large. Consider starting a new one for cleaner context.';
    return;
  }
  banner.hidden = true;
  banner.textContent = '';
}

function updateFooter(extra) {
  const footer = state.host.querySelector('#ai-panel-footer');
  if (!footer) return;
  if (!state.configured) {
    footer.innerHTML = `<span class="ai-panel-footer-warn">No Claude API key configured. <button class="ai-panel-footer-btn" id="ai-panel-footer-settings">Add one</button></span>`;
    footer.querySelector('#ai-panel-footer-settings')?.addEventListener('click', () => openSettings());
    return;
  }
  if (state.sending) {
    footer.textContent = extra || 'Streaming…';
  } else {
    footer.textContent = 'Cmd/Ctrl+Enter to send. Claude Opus 4.7.';
  }
}

function openSettings() {
  const project = projectManager.get();
  if (!project) return;
  const existing = document.querySelector('#ai-config-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'ai-config-modal';
  modal.className = 'ai-config-modal';
  modal.innerHTML = `
    <div class="ai-config-modal-backdrop"></div>
    <div class="ai-config-modal-panel">
      <div class="ai-config-modal-header">
        <h3>AI settings</h3>
        <button class="ai-config-modal-close" id="ai-config-close">×</button>
      </div>
      <div class="ai-config-modal-body">
        <label>
          <span>Claude API key</span>
          <input type="password" id="ai-config-key" placeholder="sk-ant-..." autocomplete="off">
        </label>
        <p class="ai-config-hint">
          Stored locally at <code>~/.frank/config.json</code> with <code>0600</code> permissions.
          The daemon never logs the key.
        </p>
      </div>
      <div class="ai-config-modal-footer">
        <button class="btn-secondary" id="ai-config-clear">Clear</button>
        <button class="btn-primary" id="ai-config-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('.ai-config-modal-backdrop').addEventListener('click', close);
  modal.querySelector('#ai-config-close').addEventListener('click', close);
  modal.querySelector('#ai-config-clear').addEventListener('click', async () => {
    try {
      await sync.clearAiApiKey('claude');
      state.configured = false;
      updateFooter();
      close();
    } catch (err) { alert(err.message || err); }
  });
  modal.querySelector('#ai-config-save').addEventListener('click', async () => {
    const key = modal.querySelector('#ai-config-key').value.trim();
    if (!key) { alert('Enter a Claude API key.'); return; }
    try {
      const resp = await sync.setAiApiKey('claude', key);
      state.configured = !!resp.providers?.claude?.configured;
      updateFooter();
      close();
    } catch (err) { alert(err.message || err); }
  });

  setTimeout(() => modal.querySelector('#ai-config-key')?.focus(), 50);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
