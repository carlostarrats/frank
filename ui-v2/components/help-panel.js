// help-panel.js — "Getting Started" modal.
//
// Persistent entry point for onboarding — not a first-run-only empty
// state. Five cards cover the core features. Two launch the real flow
// (Review URL, Sketch Canvas). The other three expand inline to explain
// what the feature is, since those surfaces only make sense once a
// project is open.

const ICONS = {
  url: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  canvas: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-4-4-6 6"/></svg>`,
  comments: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.42 1.42M16.95 16.95l1.42 1.42M5.64 18.36l1.42-1.42M16.95 7.05l1.42-1.42"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>`,
};

const CARDS = [
  {
    id: 'url',
    title: 'Review a URL',
    blurb: 'Paste any URL — localhost, staging, production — and Frank wraps it with commenting on top of the live content.',
    cta: 'Try it',
    action: 'focus-url',
  },
  {
    id: 'canvas',
    title: 'Sketch on a canvas',
    blurb: 'Whiteboard surface for wireframes, flowcharts, mood boards. Shapes, templates, pen, images — all persist automatically.',
    cta: 'New canvas',
    action: 'new-canvas',
  },
  {
    id: 'comments',
    title: 'Leave comments on anything',
    blurb: 'Click any element on a URL or shape on a canvas to anchor feedback. Comments follow the element as it moves.',
    cta: 'Learn more',
    action: 'expand',
    detail: 'Comments use a triple-anchor strategy (CSS selector + DOM path + visual coordinates) on URL projects so they survive refactors. On canvas, comments anchor to shape IDs and follow the shape as you move it. Every comment is a curation target — approve, dismiss, or remix before routing to AI.',
  },
  {
    id: 'ai',
    title: 'Route feedback to AI',
    blurb: 'Pipe curated feedback into your AI with a click. Frank keeps the chain of context so the AI sees what was said and why.',
    cta: 'Learn more',
    action: 'expand',
    detail: 'Approve the comments that should drive changes, remix the language if needed, then send to Claude or copy as a prompt for any other assistant. Full conversation history persists per project.',
  },
  {
    id: 'share',
    title: 'Share with reviewers',
    blurb: 'Generate a link and share a snapshot of a URL, PDF, image, or canvas. Reviewers comment from their browser with zero setup.',
    cta: 'Learn more',
    action: 'expand',
    detail: 'Share backend is a Vercel project you deploy to your own account — no Frank-operated servers, no data leaving your infra without you opting in. Run `frank connect <url> --key <key>` to wire it up.',
  },
];

export function showHelpPanel({ onFocusUrlInput, onCreateCanvas }) {
  // Close an existing instance if one's already open.
  document.querySelector('.help-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.innerHTML = `
    <div class="help-modal" role="dialog" aria-modal="true" aria-label="Getting started with Frank">
      <div class="help-modal-header">
        <h2>Getting started with Frank</h2>
        <button class="help-modal-close" id="help-close" title="Close">✕</button>
      </div>
      <p class="help-modal-subtitle">A collaboration layer for anything you're building.</p>
      <div class="help-grid">
        ${CARDS.map(card => `
          <div class="help-card" data-id="${card.id}">
            <div class="help-card-icon">${ICONS[card.id] || ''}</div>
            <h3 class="help-card-title">${escapeHtml(card.title)}</h3>
            <p class="help-card-blurb">${escapeHtml(card.blurb)}</p>
            <button class="btn-secondary help-card-cta" data-action="${card.action}" data-id="${card.id}">${escapeHtml(card.cta)}</button>
            ${card.detail ? `<div class="help-card-detail" hidden>${escapeHtml(card.detail)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#help-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onEsc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onEsc); }
  });

  overlay.querySelectorAll('.help-card-cta').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'focus-url') {
        close();
        onFocusUrlInput && onFocusUrlInput();
      } else if (action === 'new-canvas') {
        close();
        onCreateCanvas && onCreateCanvas();
      } else if (action === 'expand') {
        const card = overlay.querySelector(`.help-card[data-id="${id}"]`);
        const detail = card?.querySelector('.help-card-detail');
        if (!detail) return;
        const isOpen = !detail.hasAttribute('hidden');
        if (isOpen) {
          detail.setAttribute('hidden', '');
          btn.textContent = 'Learn more';
        } else {
          detail.removeAttribute('hidden');
          btn.textContent = 'Hide';
        }
      }
    });
  });
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}
