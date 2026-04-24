// highlight.js — Element highlight rendering

let highlightEl = null;
let selectedEl = null;

export function showHighlight(targetElement, iframeEl) {
  if (!highlightEl) {
    highlightEl = document.createElement('div');
    highlightEl.className = 'element-highlight';
    document.body.appendChild(highlightEl);
  }

  const rect = getElementRectRelativeToViewport(targetElement, iframeEl);
  highlightEl.style.display = 'block';
  highlightEl.style.left = rect.left + 'px';
  highlightEl.style.top = rect.top + 'px';
  highlightEl.style.width = rect.width + 'px';
  highlightEl.style.height = rect.height + 'px';
}

export function showSelected(targetElement, iframeEl) {
  if (!selectedEl) {
    selectedEl = document.createElement('div');
    selectedEl.className = 'element-selected';
    document.body.appendChild(selectedEl);
  }

  const rect = getElementRectRelativeToViewport(targetElement, iframeEl);
  selectedEl.style.display = 'block';
  selectedEl.style.left = rect.left + 'px';
  selectedEl.style.top = rect.top + 'px';
  selectedEl.style.width = rect.width + 'px';
  selectedEl.style.height = rect.height + 'px';
}

// Remove the DOM node (not just hide). highlight/selected elements are
// appended to document.body, so if we only hide them, they survive a view
// change — a leftover .element-highlight from the viewer would sit over
// the home page with its dashed border still drawn.
export function clearHighlight() {
  if (highlightEl) { highlightEl.remove(); highlightEl = null; }
}

export function clearSelected() {
  if (selectedEl) { selectedEl.remove(); selectedEl = null; }
}

function getElementRectRelativeToViewport(element, iframeEl) {
  const elemRect = element.getBoundingClientRect();
  const iframeRect = iframeEl.getBoundingClientRect();
  return {
    left: iframeRect.left + elemRect.left,
    top: iframeRect.top + elemRect.top,
    width: elemRect.width,
    height: elemRect.height,
  };
}
