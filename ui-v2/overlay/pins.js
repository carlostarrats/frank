// overlay/pins.js — Render numbered colored pin markers on the viewer overlay
// for each comment, mirroring the canvas pin experience.
//
// Positioning:
//   - Same-origin (and proxied) iframes: we resolve the anchored element via
//     CSS selector and place the pin at the element's viewport position inside
//     the iframe. We listen to the iframe's scroll/resize and reposition.
//   - Cross-origin: contentDocument access throws. We fall back to the
//     anchor's stored (x, y) visual coords captured at creation time. Pins
//     render but won't follow scroll — a known tradeoff.
//
// Click a pin → popover with Close / Edit / Delete (dispatches the same
// `frank:edit-comment` event the canvas uses, so the feedback panel reacts
// identically).

import sync from '../core/sync.js';
import projectManager from '../core/project.js';
import { showConfirm } from '../components/confirm.js';

const PIN_PALETTE = [
  '#f0b429', '#3b82f6', '#10b981', '#ef4444', '#a855f7',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
];

// hostEl    — element whose viewport rect defines the pin-origin (iframe or img)
// overlayEl — absolutely-positioned overlay element where pins are mounted
// screenId  — project screen id used to fetch the right comment list
export function createViewerPinRenderer({ hostEl, overlayEl, screenId }) {
  let pinsById = new Map();      // commentId → HTMLElement
  let focusedId = null;
  let popover = null;

  function resolveAnchorPoint(comment) {
    // All commenting is click-anywhere now: anchor.x / anchor.y are viewport
    // percentages of the iframe at creation time. Pin lands at that same
    // fraction of the current host rect. Legacy element-anchored comments
    // still carry x/y too, so they render — just at their stored fraction
    // instead of tracking the element.
    const a = comment.anchor || {};
    const hostRect = hostEl.getBoundingClientRect();
    const pctX = typeof a.x === 'number' ? a.x : 0;
    const pctY = typeof a.y === 'number' ? a.y : 0;
    return {
      x: (pctX / 100) * hostRect.width,
      y: (pctY / 100) * hostRect.height,
    };
  }

  function render() {
    // Destroy stale pins + rebuild. Comment volume is small; simpler than
    // diffing in place.
    for (const el of pinsById.values()) el.remove();
    pinsById.clear();

    const comments = projectManager.getCommentsForScreen(screenId);
    comments.forEach((c, idx) => {
      const pin = buildPin(c, idx);
      overlayEl.appendChild(pin);
      pinsById.set(c.id, pin);
    });

    reposition();
  }

  function buildPin(comment, idx) {
    const color = PIN_PALETTE[idx % PIN_PALETTE.length];
    const el = document.createElement('button');
    el.className = 'viewer-comment-pin';
    el.type = 'button';
    el.style.background = color;
    el.textContent = String(idx + 1);
    el.dataset.id = comment.id;
    el.setAttribute('aria-label', `Comment ${idx + 1} by ${comment.author || 'You'}`);

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      showPopover(el, comment);
    });
    return el;
  }

  function reposition() {
    const hostRect = hostEl.getBoundingClientRect();
    const overlayRect = overlayEl.getBoundingClientRect();
    const comments = projectManager.getCommentsForScreen(screenId);
    comments.forEach((c) => {
      const pin = pinsById.get(c.id);
      if (!pin) return;
      const point = resolveAnchorPoint(c);
      // Viewport-relative point from the host (iframe or img) becomes
      // overlay-local by subtracting the overlay's viewport position.
      const x = hostRect.left + point.x - overlayRect.left;
      const y = hostRect.top + point.y - overlayRect.top;
      pin.style.left = `${x}px`;
      pin.style.top = `${y}px`;
    });
  }

  function setFocused(commentId) {
    if (focusedId === commentId) return;
    if (focusedId && pinsById.get(focusedId)) {
      pinsById.get(focusedId).classList.remove('pulsing');
    }
    focusedId = commentId;
    if (!focusedId) return;
    const pin = pinsById.get(focusedId);
    if (pin) pin.classList.add('pulsing');
  }

  // ─── Pop-over ───────────────────────────────────────────────────────────

  function closePopover() {
    if (popover) { popover.remove(); popover = null; }
  }

  function showPopover(pinEl, comment) {
    closePopover();
    const pinRect = pinEl.getBoundingClientRect();

    popover = document.createElement('div');
    popover.className = 'canvas-comment-popover';
    popover.innerHTML = `
      <div class="canvas-comment-popover-header" data-drag-handle>
        <span class="canvas-comment-popover-grip" aria-hidden="true">⋮⋮</span>
        <strong>${esc(comment.author || 'You')}</strong>
        <span class="canvas-comment-popover-status">${esc(comment.status)}</span>
      </div>
      <p class="canvas-comment-popover-text">${esc(comment.text)}</p>
      <div class="canvas-comment-popover-actions">
        <button class="btn-ghost canvas-comment-popover-close">Close</button>
        <button class="btn-ghost canvas-comment-popover-edit">Edit</button>
        <button class="btn-ghost canvas-comment-popover-delete">Delete</button>
      </div>
    `;
    document.body.appendChild(popover);

    // Clamp inside viewport — same approach as canvas.
    const desiredLeft = pinRect.left + 16;
    const desiredTop = pinRect.top - 10;
    const clampedLeft = Math.max(8, Math.min(desiredLeft, window.innerWidth - popover.offsetWidth - 8));
    const clampedTop = Math.max(8, Math.min(desiredTop, window.innerHeight - popover.offsetHeight - 8));
    popover.style.left = `${clampedLeft}px`;
    popover.style.top = `${clampedTop}px`;

    makeDraggable(popover, popover.querySelector('[data-drag-handle]'));

    popover.querySelector('.canvas-comment-popover-close').addEventListener('click', closePopover);
    popover.querySelector('.canvas-comment-popover-edit').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('frank:edit-comment', { detail: { id: comment.id } }));
      closePopover();
    });
    popover.querySelector('.canvas-comment-popover-delete').addEventListener('click', async () => {
      const ok = await showConfirm({
        title: 'Delete this comment?',
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (ok) {
        sync.deleteComment(comment.id);
        closePopover();
      }
    });
  }

  function makeDraggable(el, handle) {
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = parseFloat(el.style.left) || 0;
      const startTop = parseFloat(el.style.top) || 0;
      handle.style.cursor = 'grabbing';
      const onMove = (ev) => {
        el.style.left = `${startLeft + ev.clientX - startX}px`;
        el.style.top = `${startTop + ev.clientY - startY}px`;
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        handle.style.cursor = 'grab';
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  // ─── Lifecycle: keep pins positioned as the iframe scrolls/resizes ──────

  const onWindowResize = () => reposition();
  window.addEventListener('resize', onWindowResize);

  // Attach a scroll listener inside an iframe host whenever it loads. For
  // non-iframe hosts (image), contentWindow is undefined and this is a no-op.
  const attachIframeListeners = () => {
    try {
      const win = hostEl.contentWindow;
      if (!win) return;
      win.addEventListener('scroll', reposition, { passive: true });
      win.addEventListener('resize', reposition, { passive: true });
    } catch { /* cross-origin */ }
  };
  hostEl.addEventListener?.('load', () => {
    attachIframeListeners();
    // After a page load the elements exist — re-resolve.
    reposition();
  });
  attachIframeListeners();

  // Also listen to the overlay's scrollable ancestor (image-wrapper scrolls
  // when the image is larger than the viewport). Walk up the ancestor chain
  // once and attach to any scrollable element.
  const scrollAncestors = [];
  let node = overlayEl.parentElement;
  while (node && node !== document.body) {
    const cs = getComputedStyle(node);
    if (/(auto|scroll)/.test(cs.overflowX + cs.overflowY)) {
      node.addEventListener('scroll', reposition, { passive: true });
      scrollAncestors.push(node);
    }
    node = node.parentElement;
  }

  function destroy() {
    closePopover();
    for (const el of pinsById.values()) el.remove();
    pinsById.clear();
    window.removeEventListener('resize', onWindowResize);
    try {
      const win = hostEl.contentWindow;
      win?.removeEventListener('scroll', reposition);
      win?.removeEventListener('resize', reposition);
    } catch { /* cross-origin */ }
    for (const n of scrollAncestors) n.removeEventListener('scroll', reposition);
  }

  return { render, reposition, setFocused, destroy };
}

function esc(t) {
  const d = document.createElement('div');
  d.textContent = t || '';
  return d.innerHTML;
}
