// preview.js — Prototype preview mode: clickable hotspot navigation between screens

import projectManager from '../core/project.js';
import { renderScreen, PLATFORM_DEFAULTS } from '../render/screen.js';

let currentScreenId = null;
let screenHistory = [];
let connections = {};
let onExitCallback = null;

export function renderPreview(container, { startScreenId, onExit }) {
  onExitCallback = onExit;
  screenHistory = [];
  navigateTo(container, startScreenId);

  // Escape key exits preview
  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      onExit();
    }
  }
  document.addEventListener('keydown', onKeyDown);

  // Store cleanup function
  container._previewCleanup = () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}

function cleanup() {
  // Will be called when exiting
}

function navigateTo(container, screenId) {
  const screen = projectManager.getScreen(screenId);
  if (!screen) return;

  if (currentScreenId) {
    screenHistory.push(currentScreenId);
  }
  currentScreenId = screenId;
  connections = screen.connections || {};

  const deviceClass = (screen.platform === 'ios' || screen.platform === 'android') ? 'mobile'
    : screen.platform === 'tablet' ? 'tablet'
    : screen.platform === 'web' ? 'web'
    : 'mobile';
  const viewport = screen.viewport || PLATFORM_DEFAULTS[deviceClass] || PLATFORM_DEFAULTS.web;

  const screenHtml = renderScreen(screen);

  container.innerHTML = `
    <div class="preview">
      <div class="preview-toolbar">
        <div class="preview-toolbar-left">
          <button class="preview-back-btn" ${screenHistory.length === 0 ? 'disabled' : ''} title="Go back">&larr;</button>
          <span class="preview-screen-label">${escapeHtml(screen.label || screenId)}</span>
        </div>
        <div class="preview-toolbar-right">
          <span class="preview-hint">Click highlighted elements to navigate &middot; Esc to exit</span>
          <button class="preview-exit-btn">Exit Preview</button>
        </div>
      </div>
      <div class="preview-canvas">
        <div class="preview-viewport">
          <div class="preview-content">${screenHtml}</div>
        </div>
      </div>
    </div>
  `;

  // Fit to viewport
  const previewCanvas = container.querySelector('.preview-canvas');
  const previewContent = container.querySelector('.preview-content');
  const wfDevice = previewContent.querySelector('.wf-device');

  if (wfDevice && previewCanvas) {
    requestAnimationFrame(() => {
      const canvasW = previewCanvas.clientWidth - 80;
      const canvasH = previewCanvas.clientHeight - 80;
      const deviceW = wfDevice.offsetWidth;
      const deviceH = wfDevice.offsetHeight;
      if (deviceW > 0 && deviceH > 0) {
        const scale = Math.min(canvasW / deviceW, canvasH / deviceH, 1);
        const previewViewport = container.querySelector('.preview-viewport');
        previewViewport.style.transform = `scale(${scale})`;
        previewViewport.style.transformOrigin = 'top center';
      }
    });
  }

  // Back button
  container.querySelector('.preview-back-btn').addEventListener('click', () => {
    if (screenHistory.length > 0) {
      const prevId = screenHistory.pop();
      currentScreenId = null; // Don't push to history
      navigateTo(container, prevId);
    }
  });

  // Exit button
  container.querySelector('.preview-exit-btn').addEventListener('click', () => {
    if (onExitCallback) onExitCallback();
  });

  // Apply hotspot highlighting and click handlers
  applyHotspots(container, screen);
}

function applyHotspots(container, screen) {
  const conns = screen.connections || {};
  if (Object.keys(conns).length === 0) return;

  const previewContent = container.querySelector('.preview-content');
  if (!previewContent) return;

  // Connections format: { "sectionIndex:keyword": "targetScreenId" }
  for (const [key, targetScreenId] of Object.entries(conns)) {
    const parts = key.split(':');
    const sectionIndex = parseInt(parts[0]);
    const keyword = parts.slice(1).join(':').toLowerCase();

    // Verify target screen exists
    if (!projectManager.getScreen(targetScreenId)) continue;

    // Find the section element
    const sectionEl = previewContent.querySelector(`[data-section-index="${sectionIndex}"]`);
    if (!sectionEl) continue;

    // Find elements within the section that match the keyword (fuzzy text match)
    const matchingElements = findMatchingElements(sectionEl, keyword);

    matchingElements.forEach(el => {
      el.classList.add('preview-hotspot');
      el.style.cursor = 'pointer';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigateTo(container, targetScreenId);
      });
    });
  }
}

function findMatchingElements(sectionEl, keyword) {
  const matches = [];
  const kw = keyword.toLowerCase().trim();

  // Walk all child elements looking for text content matches
  const walker = document.createTreeWalker(sectionEl, NodeFilter.SHOW_ELEMENT, null);

  while (walker.nextNode()) {
    const el = walker.currentNode;
    // Skip container elements that have children with text — prefer leaf elements
    const directText = getDirectText(el).toLowerCase().trim();

    if (directText && fuzzyMatch(directText, kw)) {
      matches.push(el);
    }
  }

  // If no leaf matches, try the section itself for buttons/links
  if (matches.length === 0) {
    // Broaden search: check all clickable-looking elements
    sectionEl.querySelectorAll('button, a, [class*="btn"], [class*="nav"]').forEach(el => {
      const text = el.textContent.toLowerCase().trim();
      if (fuzzyMatch(text, kw)) {
        matches.push(el);
      }
    });
  }

  return matches;
}

function getDirectText(el) {
  // Get text content that is directly in this element (not in child elements)
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    }
  }
  return text || el.textContent || '';
}

function fuzzyMatch(text, keyword) {
  // Exact substring
  if (text.includes(keyword)) return true;
  // Word-start matching: "get started" matches "Get Started" button
  const textWords = text.split(/\s+/);
  const kwWords = keyword.split(/\s+/);
  if (kwWords.every(kw => textWords.some(tw => tw.startsWith(kw)))) return true;
  return false;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
