// element-detect.js — Smart element detection with forgiving clicks
// Bubbles up from clicked element to nearest "meaningful" target

const SKIP_TAGS = new Set([
  'SPAN', 'EM', 'STRONG', 'BR', 'I', 'B', 'SMALL', 'SUB', 'SUP',
  'ABBR', 'MARK', 'DEL', 'INS', 'WBR', 'CODE',
]);

const SEMANTIC_TAGS = new Set([
  'BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'VIDEO',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'NAV', 'HEADER',
  'FOOTER', 'MAIN', 'SECTION', 'ARTICLE', 'FORM', 'TABLE',
  'FIGURE', 'ASIDE', 'DETAILS', 'DIALOG',
]);

export function findMeaningfulElement(target) {
  let el = target;

  while (el && el !== document.body && el !== document.documentElement) {
    if (el.nodeType === 3) { el = el.parentElement; continue; }
    if (SEMANTIC_TAGS.has(el.tagName)) return el;
    if (el.id || el.classList.length > 0) {
      if (!SKIP_TAGS.has(el.tagName)) return el;
    }
    if (hasVisibleBoundaries(el) && !SKIP_TAGS.has(el.tagName)) return el;
    el = el.parentElement;
  }

  el = target;
  while (el && SKIP_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  return el || target;
}

function hasVisibleBoundaries(el) {
  try {
    const style = window.getComputedStyle(el);
    if (style.borderWidth && style.borderWidth !== '0px' &&
        style.borderStyle && style.borderStyle !== 'none') return true;
    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
        style.backgroundColor !== 'transparent') return true;
    if (style.boxShadow && style.boxShadow !== 'none') return true;
    return false;
  } catch {
    return false;
  }
}
