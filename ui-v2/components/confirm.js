// confirm.js — Frank-styled confirm dialog to replace window.confirm().
//
// Native confirm() dialogs render in the OS style (rounded macOS modal,
// system buttons), which clashes with Frank's sharp-cornered design
// system. This helper surfaces the same prompt shape in a modal that
// matches the rest of Frank's UI.
//
// Usage:
//   const ok = await showConfirm({
//     title: 'Delete "Untitled Canvas"?',
//     message: 'It will move to Trash for 30 days.',
//     confirmLabel: 'Delete',
//     destructive: true,
//   });
//   if (!ok) return;
//
// Multiline messages: pass \n in `message`; rendered with preserved breaks.
// Returns a Promise that resolves to true (confirmed) or false (cancelled).
// Escape + overlay click + Cancel all resolve false.

export function showConfirm(opts) {
  const {
    title,
    message = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = false,
  } = opts || {};

  // Close any prior confirm overlay so stacked dialogs don't pile up.
  document.querySelector('.confirm-overlay')?.remove();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div class="confirm-body">
          ${title ? `<h3 class="confirm-title" id="confirm-title">${esc(title)}</h3>` : ''}
          ${message ? `<p class="confirm-message">${escWithBreaks(message)}</p>` : ''}
        </div>
        <div class="confirm-actions">
          <button type="button" class="btn-ghost" data-action="cancel">${esc(cancelLabel)}</button>
          <button type="button" class="${destructive ? 'btn-destructive' : 'btn-primary'}" data-action="confirm">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const previousFocus = document.activeElement;
    const confirmBtn = overlay.querySelector('[data-action="confirm"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');

    // Primary action gets focus. Destructive still focuses the destructive
    // button — it's where the user's hand is landing (they clicked Delete to
    // get here). Enter submits; Escape cancels.
    setTimeout(() => confirmBtn.focus(), 0);

    function close(result) {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        try { previousFocus.focus(); } catch {}
      }
      resolve(result);
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      } else if (e.key === 'Enter') {
        // Only auto-submit if focus is inside the dialog to avoid hijacking
        // unrelated keystrokes that happen to fire while the dialog is open.
        if (overlay.contains(document.activeElement)) {
          e.stopPropagation();
          close(true);
        }
      } else if (e.key === 'Tab') {
        // Keep Tab inside the dialog.
        const items = [cancelBtn, confirmBtn];
        const active = document.activeElement;
        if (!overlay.contains(active)) { e.preventDefault(); items[0].focus(); return; }
        const idx = items.indexOf(active);
        if (e.shiftKey && idx === 0) { e.preventDefault(); items[items.length - 1].focus(); }
        else if (!e.shiftKey && idx === items.length - 1) { e.preventDefault(); items[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function escWithBreaks(s) {
  return esc(s).replace(/\n/g, '<br>');
}
