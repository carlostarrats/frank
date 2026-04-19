// toast.js — Transient status notifications.
//
// Three kinds:
//   info  — auto-dismisses after 4s, muted background
//   warn  — auto-dismisses after 6s, amber accent
//   error — persists until user dismisses, red accent
//
// Toasts stack top-right; the host container is created on first use and
// reused thereafter.

const DEFAULT_TTL = { info: 4000, warn: 6000, error: 0 };

function host() {
  let el = document.getElementById('toast-host');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-host';
    el.className = 'toast-host';
    document.body.appendChild(el);
  }
  return el;
}

function renderToast({ kind = 'info', message, actionLabel, onAction, ttl }) {
  const container = host();
  const toast = document.createElement('div');
  toast.className = `toast toast-${kind}`;
  toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  const iconFor = {
    info:  '',
    warn:  '!',
    error: '×',
  };

  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${iconFor[kind] || ''}</span>
    <span class="toast-message"></span>
    ${actionLabel ? `<button class="toast-action" type="button"></button>` : ''}
    <button class="toast-close" type="button" aria-label="Dismiss">✕</button>
  `;
  toast.querySelector('.toast-message').textContent = message;
  const actionBtn = toast.querySelector('.toast-action');
  if (actionBtn) actionBtn.textContent = actionLabel;

  const dismiss = () => {
    if (!toast.parentNode) return;
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.remove(), 150);
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  if (actionBtn && onAction) {
    actionBtn.addEventListener('click', () => {
      try { onAction(); } finally { dismiss(); }
    });
  }

  container.appendChild(toast);

  const effectiveTtl = ttl != null ? ttl : DEFAULT_TTL[kind];
  if (effectiveTtl > 0) setTimeout(dismiss, effectiveTtl);

  return { dismiss };
}

export function toastInfo(message, opts = {}) {
  return renderToast({ kind: 'info', message, ...opts });
}
export function toastWarn(message, opts = {}) {
  return renderToast({ kind: 'warn', message, ...opts });
}
export function toastError(message, opts = {}) {
  return renderToast({ kind: 'error', message, ...opts });
}
