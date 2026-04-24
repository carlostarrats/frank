// comment-composer.js — one composer for every commenting surface.
//
// Canvas, viewer (URL/PDF/image), and the pin popover on shared URLs all go
// through this helper so the comment box looks and behaves the same
// everywhere: same DOM, same CSS class (.canvas-comment-input), draggable
// from a small handle at the top, Cmd/Ctrl+Enter submits, Escape cancels.
//
// openCommentComposer({ clientX, clientY, onSubmit, onCancel? })
//   - clientX / clientY: viewport coords to anchor the composer near
//   - onSubmit(text): called with the trimmed text on Post
//   - onCancel: optional, called on Cancel / Escape
// Returns { close } so the caller can dismiss the composer on its own.

const COMPOSER_WIDTH = 260;
const COMPOSER_HEIGHT = 120;
const CLAMP_PAD = 12;

export function openCommentComposer({ clientX, clientY, onSubmit, onCancel }) {
  const pad = CLAMP_PAD;
  const left = Math.min(Math.max(pad, clientX + 12), window.innerWidth - COMPOSER_WIDTH - pad);
  const top = Math.min(Math.max(pad, clientY + 12), window.innerHeight - COMPOSER_HEIGHT - pad);

  const el = document.createElement('div');
  el.className = 'canvas-comment-input';
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.innerHTML = `
    <div class="canvas-comment-input-drag" data-drag-handle aria-label="Drag to move">
      <span class="canvas-comment-input-grip" aria-hidden="true">⋮⋮</span>
    </div>
    <textarea class="canvas-comment-input-textarea" rows="2" placeholder="Add a comment…" aria-label="New comment"></textarea>
    <div class="canvas-comment-input-actions">
      <button type="button" class="btn-ghost canvas-comment-cancel">Cancel</button>
      <button type="button" class="btn-primary canvas-comment-submit">Post</button>
    </div>
  `;
  document.body.appendChild(el);

  const ta = el.querySelector('textarea');
  const dragHandle = el.querySelector('[data-drag-handle]');
  ta.focus();

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    el.remove();
  }
  function cancel() {
    close();
    onCancel?.();
  }
  function submit() {
    const text = ta.value.trim();
    if (!text) { cancel(); return; }
    onSubmit?.(text);
    close();
  }

  el.querySelector('.canvas-comment-cancel').addEventListener('click', cancel);
  el.querySelector('.canvas-comment-submit').addEventListener('click', submit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); cancel(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });

  // Drag the whole composer from the grip strip. Clamp so it can never be
  // dragged entirely off-screen — keep 40px of the box visible on each side.
  attachDrag(el, dragHandle);

  return { close };
}

function attachDrag(el, handle) {
  let dragging = false;
  let startX = 0, startY = 0, origLeft = 0, origTop = 0;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    const rect = el.getBoundingClientRect();
    origLeft = rect.left; origTop = rect.top;
    try { handle.setPointerCapture(e.pointerId); } catch {}
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const rect = el.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const minLeft = -(w - 40);
    const maxLeft = window.innerWidth - 40;
    const minTop = 0;
    const maxTop = window.innerHeight - 32;
    const nl = Math.min(maxLeft, Math.max(minLeft, origLeft + dx));
    const nt = Math.min(maxTop, Math.max(minTop, origTop + dy));
    el.style.left = `${nl}px`;
    el.style.top = `${nt}px`;
  });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { handle.releasePointerCapture(e.pointerId); } catch {}
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
}
