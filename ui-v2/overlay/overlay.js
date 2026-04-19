// overlay.js — Transparent overlay controller
import { findMeaningfulElement } from './element-detect.js';
import { createAnchor, createPinAnchor } from './anchoring.js';
import { showHighlight, showSelected, clearHighlight, clearSelected } from './highlight.js';
import { COMMENT_CURSOR } from '../canvas/cursors.js';

let commentMode = false;
let onCommentCreate = null;
let currentIframe = null;

export function setupOverlay(iframeEl, callbacks) {
  currentIframe = iframeEl;
  onCommentCreate = callbacks.onCommentCreate;

  iframeEl.addEventListener('load', () => {
    try {
      const doc = iframeEl.contentDocument;
      if (!doc) return;

      doc.addEventListener('mousemove', (e) => {
        if (!commentMode) return;
        const target = findMeaningfulElement(e.target);
        showHighlight(target, iframeEl);
      });

      doc.addEventListener('click', (e) => {
        if (!commentMode) return;
        e.preventDefault();
        e.stopPropagation();

        const target = findMeaningfulElement(e.target);
        const iframeRect = iframeEl.getBoundingClientRect();

        // Empty-space click (no meaningful element above the target) drops a
        // free pin at the click coords — same behavior as canvas. Otherwise
        // anchor to the found element with the triple-anchor strategy.
        const isEmptyClick = !target || target === doc.body || target === doc.documentElement;
        let anchor;
        if (isEmptyClick) {
          // e.clientX/Y are relative to the iframe's own viewport.
          anchor = createPinAnchor(e.clientX, e.clientY, { width: iframeRect.width, height: iframeRect.height });
          clearHighlight();
          clearSelected();
        } else {
          showSelected(target, iframeEl);
          clearHighlight();
          anchor = createAnchor(target, iframeRect);
        }

        if (onCommentCreate) {
          onCommentCreate(anchor, isEmptyClick ? null : target);
        }
      });

      doc.addEventListener('mouseleave', () => {
        clearHighlight();
      });
    } catch (e) {
      console.warn('[overlay] cannot attach to iframe (cross-origin):', e.message);
    }
  });
}

export function enableCommentMode() {
  commentMode = true;
  // Custom speech-bubble-plus cursor — same one the canvas uses so the two
  // surfaces feel identical. Applied to the iframe body (cross-origin blocks
  // access; we fall back to the default cursor in that case).
  if (currentIframe) {
    try {
      const doc = currentIframe.contentDocument;
      if (doc) doc.body.style.cursor = COMMENT_CURSOR;
    } catch { /* cross-origin */ }
  }
}

export function disableCommentMode() {
  commentMode = false;
  clearHighlight();
  clearSelected();
  if (currentIframe) {
    try {
      const doc = currentIframe.contentDocument;
      if (doc) doc.body.style.cursor = '';
    } catch { /* cross-origin */ }
  }
}

export function toggleCommentMode() {
  if (commentMode) disableCommentMode();
  else enableCommentMode();
  return commentMode;
}

export function isCommentModeActive() {
  return commentMode;
}
