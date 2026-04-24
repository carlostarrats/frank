// overlay.js — Transparent overlay controller
//
// Click-anywhere commenting, identical to canvas + the reviewer overlay:
//   - enabling comment mode puts `comment-mode` on the overlay div, which
//     captures clicks (pointer-events: auto) and shows a crosshair cursor
//   - a click on the overlay drops a free pin at the click point and opens
//     a small composer popover in place (same CSS class as the canvas
//     composer so they're visually identical)
//   - submit posts the comment via the callback; cancel / Esc discards
//
// Capturing clicks on the overlay div (not the iframe's contentDocument)
// means cross-origin iframes work too — we never need to reach inside.
import { createPinAnchor } from './anchoring.js';
import { openCommentComposer } from '../components/comment-composer.js';

let commentMode = false;
let onCommentSubmit = null;
let currentIframe = null;
let currentOverlayEl = null;
let composerEl = null;

export function setupOverlay(iframeEl, overlayEl, callbacks) {
  currentIframe = iframeEl;
  currentOverlayEl = overlayEl;
  onCommentSubmit = callbacks.onCommentSubmit;

  overlayEl.addEventListener('click', (e) => {
    if (!commentMode) return;
    e.preventDefault();
    e.stopPropagation();
    const iframeRect = iframeEl.getBoundingClientRect();
    const relX = e.clientX - iframeRect.left;
    const relY = e.clientY - iframeRect.top;
    const anchor = createPinAnchor(relX, relY, { width: iframeRect.width, height: iframeRect.height });
    openComposer(e.clientX, e.clientY, anchor);
  });
}

export function enableCommentMode() {
  commentMode = true;
  if (currentOverlayEl) currentOverlayEl.classList.add('comment-mode');
}

export function disableCommentMode() {
  commentMode = false;
  if (currentOverlayEl) currentOverlayEl.classList.remove('comment-mode');
  closeComposer();
}

export function toggleCommentMode() {
  if (commentMode) disableCommentMode();
  else enableCommentMode();
  return commentMode;
}

export function isCommentModeActive() {
  return commentMode;
}

// Shared composer — identical DOM/CSS/drag behavior with canvas.
function closeComposer() {
  if (composerEl) { composerEl.close(); composerEl = null; }
}

function openComposer(clientX, clientY, anchor) {
  closeComposer();
  composerEl = openCommentComposer({
    clientX,
    clientY,
    onSubmit: (text) => { if (onCommentSubmit) onCommentSubmit(anchor, text); },
  });
}
