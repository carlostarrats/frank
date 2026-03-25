// undo.js — 10-state undo stack per screen

const MAX_STATES = 10;
const stacks = {};

function getStack(screenId) {
  if (!stacks[screenId]) stacks[screenId] = { undo: [], redo: [] };
  return stacks[screenId];
}

const undoManager = {
  push(screenId, sections) {
    const stack = getStack(screenId);
    stack.undo.push(JSON.parse(JSON.stringify(sections)));
    if (stack.undo.length > MAX_STATES) stack.undo.shift();
    stack.redo = [];
  },

  undo(screenId, currentSections) {
    const stack = getStack(screenId);
    if (stack.undo.length === 0) return null;
    stack.redo.push(JSON.parse(JSON.stringify(currentSections)));
    return stack.undo.pop();
  },

  redo(screenId, currentSections) {
    const stack = getStack(screenId);
    if (stack.redo.length === 0) return null;
    stack.undo.push(JSON.parse(JSON.stringify(currentSections)));
    return stack.redo.pop();
  },

  canUndo(screenId) { return (stacks[screenId]?.undo.length || 0) > 0; },
  canRedo(screenId) { return (stacks[screenId]?.redo.length || 0) > 0; },
  undoCount(screenId) { return stacks[screenId]?.undo.length || 0; },
  redoCount(screenId) { return stacks[screenId]?.redo.length || 0; },
  clear(screenId) { delete stacks[screenId]; },
};

export default undoManager;
