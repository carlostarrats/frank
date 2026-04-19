// error-card.js — Inline error card for in-place failure states.
//
// Toasts are for transient notifications; an error card replaces the
// content it belongs to. Use it when a surface failed to load or render
// (iframe blocked, share backend unreachable) and the user needs a clear
// path forward — a message, a suggested action, and a retry button.

export function renderErrorCard(container, {
  title = 'Something went wrong',
  message,
  suggestion,
  actionLabel = 'Retry',
  onAction,
  dismissLabel,
  onDismiss,
} = {}) {
  container.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'error-card';
  card.innerHTML = `
    <div class="error-card-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="13"/>
        <line x1="12" y1="16.5" x2="12.01" y2="16.5"/>
      </svg>
    </div>
    <div class="error-card-body">
      <h3 class="error-card-title"></h3>
      <p class="error-card-message"></p>
      ${suggestion ? `<p class="error-card-suggestion"></p>` : ''}
      <div class="error-card-actions">
        ${onAction ? `<button class="btn-primary error-card-action" type="button"></button>` : ''}
        ${onDismiss ? `<button class="btn-secondary error-card-dismiss" type="button"></button>` : ''}
      </div>
    </div>
  `;

  card.querySelector('.error-card-title').textContent = title;
  card.querySelector('.error-card-message').textContent = message || '';
  if (suggestion) card.querySelector('.error-card-suggestion').textContent = suggestion;

  const actionBtn = card.querySelector('.error-card-action');
  if (actionBtn && onAction) {
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener('click', onAction);
  }
  const dismissBtn = card.querySelector('.error-card-dismiss');
  if (dismissBtn && onDismiss) {
    dismissBtn.textContent = dismissLabel || 'Dismiss';
    dismissBtn.addEventListener('click', onDismiss);
  }

  container.appendChild(card);
}
