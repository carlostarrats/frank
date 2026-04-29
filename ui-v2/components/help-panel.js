// help-panel.js — "Getting Started" modal.
//
// Persistent entry point for onboarding — not a first-run-only empty
// state. Stacked list of <details> disclosures, one per feature.
// Clicking a row expands it inline (same pattern Settings uses).
// Two items (Review URL, Sketch Canvas) expose an action button
// inside the expanded body.

const ICONS = {
  url: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  canvas: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-4-4-6 6"/></svg>`,
  comments: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  ai: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.42 1.42M16.95 16.95l1.42 1.42M5.64 18.36l1.42-1.42M16.95 7.05l1.42-1.42"/></svg>`,
  share: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98"/></svg>`,
  'url-share': `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/><polyline points="12 12 12 21"/><polyline points="8 16 12 12 16 16"/></svg>`,
  live: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M17.66 6.34a9 9 0 0 1 0 11.31M6.34 17.66a9 9 0 0 1 0-11.31M19.78 4.22a12 12 0 0 1 0 15.56M4.22 19.78a12 12 0 0 1 0-15.56"/></svg>`,
};

const ITEMS = [
  {
    id: 'url',
    title: 'Review a URL',
    body: 'Paste any URL — localhost, staging, production — and Frank wraps it with commenting on top of the live content.',
    action: { label: 'Try it', type: 'focus-url' },
  },
  {
    id: 'canvas',
    title: 'Sketch on a canvas',
    body: 'Whiteboard surface for wireframes, flowcharts, mood boards. Shapes, templates, pen, images — all persist automatically. Supports live multiplayer editing (see Live collaboration below).',
    action: { label: 'New canvas', type: 'new-canvas' },
  },
  {
    id: 'comments',
    title: 'Leave comments on anything',
    body: `Click any element on a URL or shape on a canvas to anchor feedback. Comments follow the element as it moves. Reviewer comments sync back to the author automatically.

On URL / PDF / image projects comments use a triple-anchor strategy (CSS selector + DOM path + visual coordinates) so they survive refactors. On canvas, comments anchor to shape IDs and follow the shape as you move it. Every comment is a curation target — approve, dismiss, or remix before routing to AI.`,
  },
  {
    id: 'ai',
    title: 'Route feedback to AI',
    body: `Pipe curated feedback into the AI tool you already use — Claude, Cursor, ChatGPT, a local LLM, whatever.

Three paths: click "Copy as prompt" on any approved comment for a structured prompt on your clipboard; export the whole project as JSON or Markdown/PDF to hand off everything at once; or let your AI connect directly via MCP — Settings → MCP Setup has the config snippet. URL and canvas projects also get a "Send to v0" button: configure a v0 API key in Settings to append curated feedback as a follow-up message in an existing v0 chat (one click, no copy/paste), or leave it unset to open v0.dev with the prompt prefilled in a new tab.

Frank deliberately doesn't bundle an in-app AI chat — that would lock you into one provider and force API-key management. Use whichever AI you already trust.`,
  },
  {
    id: 'share',
    title: 'Share with reviewers',
    body: `Generate a link and send PDF, image, or canvas projects as snapshots. Reviewers open it in any browser with zero setup — no account, no install.

Async by default: reviewers see the snapshot as it was when you shared; comments they add sync back to you. For canvas projects, you can flip the share into live mode — see Live collaboration below.

Share backend is a Vercel project you deploy to your own account (or any host implementing Frank's Cloud API). Click the ⚙ Settings cog on the home page to configure it. Nothing leaves your infrastructure unless you opt in.`,
  },
  {
    id: 'url-share',
    title: 'Share a localhost app (URL auto-deploy)',
    body: `Point Frank at a local project directory (Next.js, Vite + React/Svelte/Vue, SvelteKit, Astro, Remix). Frank runs a pre-flight check, auto-generates safe-dummy env for common SDKs (Supabase / Clerk / Stripe / Sentry / Auth0 / PostHog), injects a same-origin comment overlay, and deploys a preview to your own Vercel account.

Reviewers open the preview URL and interact with the real running app — hovers, modals, client state all work. Not a screenshot.

Configure a Vercel deploy token once in Settings → Share Preview, point at your project directory, click Check envelope → Run pre-flight → Create share. Revoke flips the share link immediately and tears down the Vercel deployment.

Frank's URL share is for early-stage work — your app runs with placeholder backends. Pages that block on a real-backend call (e.g. a login page that calls \`getSession()\` on mount) will spin forever. Add the \`FRANK_SHARE=1\` guard from docs/share-guards.md or disable the probe before sharing.`,
  },
  {
    id: 'live',
    title: 'Collaborate live (canvas)',
    body: `Turn any canvas share into a live session. Every shape edit, drop, move, and comment propagates to open viewers in near real time. Presence counter shows how many reviewers are watching.

Create a canvas share, click "Start live share" in the share popover, and the toolbar icon picks up a LIVE · N badge (N = viewers currently watching). Sessions auto-pause after 2 hours so you do not accidentally leave one open; click Resume to continue. You can Revoke the link at any time; revoked links go cold immediately.

For URL shares, the auto-deploy approach (above) gives reviewers the real interactive app without needing a live session. PDF and image shares stay on the async snapshot path — for those, screen-sharing (Google Meet, Zoom, etc.) is the better real-time tool.`,
  },
];

export function showHelpPanel({ onFocusUrlInput, onCreateCanvas }) {
  // Close an existing instance if one's already open.
  document.querySelector('.help-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.innerHTML = `
    <div class="help-modal help-modal-stack" role="dialog" aria-modal="true" aria-label="Getting started with Frank">
      <div class="help-modal-header">
        <h2>Getting started with Frank</h2>
        <button class="help-modal-close" id="help-close" title="Close">✕</button>
      </div>
      <p class="help-modal-subtitle">A collaboration layer for anything you're building.</p>
      <div class="help-list">
        ${ITEMS.map(item => `
          <details class="help-item" data-id="${item.id}">
            <summary>
              <span class="help-item-icon">${ICONS[item.id] || ''}</span>
              <span class="help-item-title">${escapeHtml(item.title)}</span>
            </summary>
            <div class="help-item-body">
              <p>${escapeHtml(item.body)}</p>
              ${item.action ? `<button class="btn-secondary help-item-cta" data-action="${item.action.type}">${escapeHtml(item.action.label)}</button>` : ''}
            </div>
          </details>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Save the currently-focused element so we can restore focus on close
  // (WCAG guidance: modal close returns focus to the control that opened it).
  const previousFocus = document.activeElement;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
  };

  overlay.querySelector('#help-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // Keyboard handling: Esc closes, Tab cycles only within the modal (focus trap).
  function focusable() {
    return Array.from(overlay.querySelectorAll(
      'button:not([disabled]), summary, [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
    ));
  }
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusable();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (!overlay.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  // Initial focus goes on the close button — avoids accidentally toggling a
  // disclosure if the user hits Enter immediately.
  setTimeout(() => overlay.querySelector('#help-close').focus(), 0);

  // Action buttons live inside the expanded body; click them to launch flow.
  overlay.querySelectorAll('.help-item-cta').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      if (action === 'focus-url') {
        close();
        onFocusUrlInput && onFocusUrlInput();
      } else if (action === 'new-canvas') {
        close();
        onCreateCanvas && onCreateCanvas();
      }
    });
  });
}

function escapeHtml(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}
