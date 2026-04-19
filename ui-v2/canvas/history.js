// history.js — In-memory undo/redo stack for the canvas.
//
// Strategy:
//   - Keep `currentState` = most recent serialized state (set at init).
//   - On each commit: if serialized state changed, push the *previous*
//     currentState onto the undo stack, clear redo, update currentState.
//   - Undo: push current to redo, pop from undo, deserialize.
//   - Redo: inverse.
//   - `suspended` flag prevents undo/redo-triggered commits from feeding
//     back into the stack.
//
// Scope note: canvas-only for v2. Non-canvas surfaces (comments, shares)
// aren't unified here — see the open-question decision on undo in v2.
//
// Memory: ring buffer capped at MAX_ENTRIES. Canvas projects worth undoing
// are rarely more than a few hundred KB of serialized state, so 50 entries
// stays well under a few MB in the worst case.

const MAX_ENTRIES = 50;

export function createHistory({ serialize, deserialize }) {
  let undoStack = [];
  let redoStack = [];
  let currentState = null;
  let suspended = false;

  function init() {
    currentState = serialize();
  }

  function commit() {
    if (suspended) return;
    const next = serialize();
    if (next === currentState) return;
    if (currentState != null) {
      undoStack.push(currentState);
      if (undoStack.length > MAX_ENTRIES) undoStack.shift();
    }
    redoStack.length = 0;
    currentState = next;
  }

  function undo() {
    if (undoStack.length === 0) return false;
    suspended = true;
    try {
      redoStack.push(currentState);
      const prev = undoStack.pop();
      currentState = prev;
      deserialize(prev);
    } finally {
      suspended = false;
    }
    return true;
  }

  function redo() {
    if (redoStack.length === 0) return false;
    suspended = true;
    try {
      undoStack.push(currentState);
      const next = redoStack.pop();
      currentState = next;
      deserialize(next);
    } finally {
      suspended = false;
    }
    return true;
  }

  function reset(state) {
    undoStack = [];
    redoStack = [];
    currentState = state !== undefined ? state : serialize();
  }

  return {
    init,
    commit,
    undo,
    redo,
    reset,
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    isSuspended: () => suspended,
  };
}
