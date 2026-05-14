// text-edit.js — DOM textarea overlay for editable Konva text nodes.

export function attachTextEdit(anchor, textNode, options = {}) {
  if (!anchor || !textNode || anchor._frankTextEditAttached) return;
  anchor._frankTextEditAttached = true;

  const open = () => {
    if (typeof options.shouldEdit === 'function' && !options.shouldEdit(anchor, textNode)) return;
    openTextEditor(textNode, options.onCommit);
  };

  anchor.on('click tap dblclick dbltap', open);
}

export function bindEditableTextInLayer(layer, options = {}) {
  if (!layer || typeof layer.getChildren !== 'function') return;
  for (const node of layer.getChildren()) {
    bindEditableTextNode(node, options);
  }
}

export function bindEditableTextNode(node, options = {}) {
  const textNode = editableTextNodeFor(node);
  if (!textNode) return;
  attachTextEdit(node, textNode, options);
}

export function editableTextNodeFor(node) {
  if (!node || typeof node.getClassName !== 'function') return null;
  if (node.getClassName() === 'Text' && hasName(node, 'text')) return node;
  if (hasName(node, 'sticky')) return findTextChild(node);
  return null;
}

function openTextEditor(textNode, onCommit) {
  const stage = textNode.getStage();
  if (!stage || stage.container().querySelector('.canvas-text-editor')) return;

  const abs = textNode.getAbsolutePosition();
  const scale = stage.scaleX() || 1;

  const ta = document.createElement('textarea');
  ta.value = textNode.text();
  ta.className = 'canvas-text-editor';
  ta.style.position = 'absolute';
  ta.style.left = abs.x + 'px';
  ta.style.top = abs.y + 'px';
  ta.style.width = Math.max(80, (textNode.width() || 160) * scale) + 'px';
  ta.style.fontSize = textNode.fontSize() * scale + 'px';
  ta.style.fontFamily = textNode.fontFamily();
  ta.style.color = textNode.fill();
  stage.container().appendChild(ta);
  ta.focus();
  ta.select();

  let closed = false;
  const commit = () => {
    if (closed) return;
    closed = true;
    const next = ta.value;
    const changed = next !== textNode.text();
    textNode.text(next);
    ta.remove();
    textNode.getLayer()?.batchDraw();
    if (changed && typeof onCommit === 'function') onCommit();
  };

  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      commit();
    }
  });
}

function findTextChild(node) {
  if (typeof node.findOne === 'function') {
    const found = node.findOne('Text');
    if (found) return found;
  }
  if (typeof node.getChildren === 'function') {
    return node.getChildren().find((child) => child.getClassName?.() === 'Text') || null;
  }
  return null;
}

function hasName(node, name) {
  return String(node.name?.() || '').split(/\s+/).includes(name);
}
