// anchoring.js — Triple-anchor: CSS selector + DOM path + coordinates

export function createAnchor(element, iframeRect) {
  const rect = element.getBoundingClientRect();
  return {
    type: 'element',
    cssSelector: getCssSelector(element),
    domPath: getDomPath(element),
    x: iframeRect ? ((rect.left + rect.width / 2) / iframeRect.width) * 100 : 0,
    y: iframeRect ? ((rect.top + rect.height / 2) / iframeRect.height) * 100 : 0,
  };
}

export function createPinAnchor(x, y, containerRect, pageNumber) {
  return {
    type: 'pin',
    x: (x / containerRect.width) * 100,
    y: (y / containerRect.height) * 100,
    ...(pageNumber != null ? { pageNumber } : {}),
  };
}

export function resolveAnchor(anchor, doc) {
  if (anchor.type === 'pin') {
    return { type: 'coordinates', x: anchor.x, y: anchor.y };
  }

  if (anchor.cssSelector) {
    try {
      const el = doc.querySelector(anchor.cssSelector);
      if (el) return { type: 'element', element: el };
    } catch {}
  }

  if (anchor.domPath) {
    try {
      const el = doc.querySelector(anchor.domPath);
      if (el) return { type: 'element', element: el };
    } catch {}
  }

  return { type: 'coordinates', x: anchor.x, y: anchor.y, moved: true };
}

function getCssSelector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    if (current.classList.length > 0) {
      const cls = Array.from(current.classList).find(c =>
        !c.startsWith('_') && c.length > 1 && c.length < 50
      );
      if (cls) selector += `.${CSS.escape(cls)}`;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function getDomPath(el) {
  const parts = [];
  let current = el;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (parent) {
      const index = Array.from(parent.children).indexOf(current) + 1;
      parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    } else {
      parts.unshift(current.tagName.toLowerCase());
    }
    current = parent;
  }
  parts.unshift('body');
  return parts.join(' > ');
}
