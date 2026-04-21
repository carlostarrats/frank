// intent-button.js — "Intent" pill rendered in the viewer toolbar and canvas
// topbar. Amber-outlined when empty (nudges the user to fill it in), green
// with a checkmark when set. Click opens the explainer modal with a textarea.
//
// Intent is the project brief — what the user is building, what success looks
// like — and rides along with every AI handoff so feedback is read against
// the actual goal. Field lives on the ProjectV2 record (`project.intent`).

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

// Mount the button into `host`. Re-renders itself on project changes so a
// saved intent flips the pill to its filled/green state without a reload.
export function mountIntentButton(host) {
  if (!host) return () => {};

  // Inline SVG check — the unicode ✓ glyph renders as a hairline diagonal at
  // this size across most Mono/UI fonts, so a heavier SVG stroke reads much
  // better against the pill's outline.
  const CHECK_ICON = `<svg class="intent-pill-check" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg>`;

  const render = () => {
    const project = projectManager.get();
    const filled = !!(project && project.intent && project.intent.trim());
    host.innerHTML = '';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `intent-pill ${filled ? 'intent-pill-filled' : 'intent-pill-empty'}`;
    btn.title = filled ? 'Edit project intent' : 'Add a project brief so AI handoffs carry context';
    btn.innerHTML = filled ? `${CHECK_ICON}<span>Intent</span>` : 'Add Intent';
    btn.addEventListener('click', openIntentModal);
    host.appendChild(btn);
  };

  render();
  projectManager.onChange(render);
  return () => projectManager.offChange(render);
}

function openIntentModal() {
  document.querySelector('.intent-modal')?.remove();
  const project = projectManager.get();
  const projectId = projectManager.getId();
  if (!project || !projectId) return;

  const modal = document.createElement('div');
  modal.className = 'intent-modal';
  modal.innerHTML = `
    <div class="intent-modal-overlay" data-intent-close></div>
    <div class="intent-modal-dialog" role="dialog" aria-labelledby="intent-modal-title">
      <h3 id="intent-modal-title">What you're building</h3>
      <p class="intent-modal-body">
        Frank includes this whenever you hand off to AI. With it, feedback like
        "make this tighter" gets read against your actual goal instead of in a
        vacuum.
      </p>
      <p class="intent-modal-example">
        <em>Example:</em> Redesigning the signup flow for first-time mobile
        users. Success = fewer drop-offs at the password step.
      </p>
      <textarea
        class="input intent-modal-textarea"
        id="intent-modal-input"
        rows="5"
        maxlength="2000"
        placeholder="What are you building, and what does success look like?"
      >${esc(project.intent || '')}</textarea>
      <div class="intent-modal-actions">
        <button class="btn-ghost" data-intent-close>Cancel</button>
        <button class="btn-primary" id="intent-modal-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelectorAll('[data-intent-close]').forEach(el => el.addEventListener('click', close));
  const onEsc = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onEsc); } };
  window.addEventListener('keydown', onEsc);

  const input = modal.querySelector('#intent-modal-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  modal.querySelector('#intent-modal-save').addEventListener('click', async () => {
    const value = input.value.trim();
    try {
      const res = await sync.setProjectIntent(projectId, value);
      if (res && res.project) {
        projectManager.setFromLoaded({ ...res, projectId });
      }
      close();
    } catch (err) {
      console.warn('[intent] save failed:', err);
      close();
    }
  });
}

function esc(t) { const d = document.createElement('div'); d.textContent = t || ''; return d.innerHTML; }
