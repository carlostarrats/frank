// color-picker.js — Coloris setup for the canvas inspector.
//
// Coloris is loaded from CDN in index.html as a global `window.Coloris`.
// The library doesn't watch the DOM for new `data-coloris` inputs, so every
// time the inspector re-renders we call bindColorisFields() to wrap any
// newly-mounted color inputs (wrap is idempotent — already-wrapped inputs
// are skipped).
//
// 15 swatches arranged as 3 rows of 5: warm / cool / purple+neutral.

const SWATCHES = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ffffff',
  '#a1a1aa',
  '#18181b',
];

let configured = false;

function getColoris() {
  return typeof window !== 'undefined' ? window.Coloris : null;
}

export function ensureColorisConfigured() {
  if (configured) return;
  const Coloris = getColoris();
  if (!Coloris) return;

  Coloris({
    themeMode: 'dark',
    theme: 'default',
    format: 'hex',
    alpha: false,
    focusInput: false,
    swatches: SWATCHES,
    swatchesOnly: false,
  });
  configured = true;
}

// Wrap every `.coloris` input under `root` that isn't already wrapped.
// Safe to call repeatedly — Coloris's wrapColorField() guards against
// double-wrapping by checking for the `.clr-field` parent class.
export function bindColorisFields(root) {
  const Coloris = getColoris();
  if (!Coloris || !root) return;
  const fields = root.querySelectorAll('input.coloris');
  fields.forEach((el) => {
    if (el.parentNode && el.parentNode.classList.contains('clr-field')) return;
    Coloris({ el });
  });
}
