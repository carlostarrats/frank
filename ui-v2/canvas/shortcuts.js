// shortcuts.js — Canvas keyboard shortcuts.
//
// Tool picks and history operations. Delete/Backspace and Cmd+G / Cmd+Shift+G
// live in transformer.js (selection-scoped). Everything else lives here.
//
// Bindings (matches Figma/Sketch/FigJam convention):
//   V             — Select
//   R             — Rectangle
//   T             — Text
//   P             — Pen (freehand)
//   N             — Sticky note
//   A             — Arrow
//   Esc           — Deselect + return to Select tool
//   Cmd/Ctrl+Z    — Undo
//   Cmd/Ctrl+⇧+Z  — Redo
//   Cmd/Ctrl+D    — Duplicate selection (+20/+20 offset)

const TOOL_KEYS = {
  v: 'select',
  r: 'rectangle',
  t: 'text',
  p: 'freehand',
  n: 'sticky',
  a: 'arrow',
};

export function attachShortcuts({ onTool, onEscape, onUndo, onRedo, onDuplicate }) {
  const handler = (e) => {
    if (isTypingTarget(e.target)) return;

    const key = (e.key || '').toLowerCase();
    const mod = e.metaKey || e.ctrlKey;

    // History + duplicate take priority and always need preventDefault.
    if (mod && (key === 'z')) {
      e.preventDefault();
      if (e.shiftKey) { onRedo && onRedo(); }
      else { onUndo && onUndo(); }
      return;
    }
    if (mod && key === 'd') {
      e.preventDefault();
      onDuplicate && onDuplicate();
      return;
    }

    // Plain-key tool shortcuts — skip if any modifier held (don't hijack
    // Cmd+R browser reload, etc.).
    if (mod || e.altKey) return;

    if (key === 'escape') {
      onEscape && onEscape();
      return;
    }

    const tool = TOOL_KEYS[key];
    if (tool) {
      e.preventDefault();
      onTool && onTool(tool);
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}
