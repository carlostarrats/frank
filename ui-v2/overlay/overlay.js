// overlay.js — Transparent overlay controller
import { findMeaningfulElement } from './element-detect.js';
import { createAnchor } from './anchoring.js';
import { showHighlight, showSelected, clearHighlight, clearSelected } from './highlight.js';

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
        showSelected(target, iframeEl);
        clearHighlight();

        const iframeRect = iframeEl.getBoundingClientRect();
        const anchor = createAnchor(target, iframeRect);

        if (onCommentCreate) {
          onCommentCreate(anchor, target);
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
  // Set crosshair cursor on the iframe itself (not the overlay — overlay has pointer-events: none)
  if (currentIframe) {
    try {
      const doc = currentIframe.contentDocument;
      if (doc) doc.body.style.cursor = 'crosshair';
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
