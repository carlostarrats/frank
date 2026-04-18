// transformer.js — Selection and transform handles for canvas shapes.
//
// Single click on a shape selects it. Shift-click adds to selection. Click on
// empty stage clears. Konva.Transformer renders the move/resize/rotate handles
// on the UI layer, so it never gets serialized into the content state.

export function createSelection({ stage, contentLayer, uiLayer, getTool }) {
  const Konva = window.Konva;
  const tr = new Konva.Transformer({
    rotateAnchorOffset: 24,
    anchorSize: 9,
    anchorStrokeWidth: 1,
    borderStrokeWidth: 1,
    anchorCornerRadius: 2,
  });
  uiLayer.add(tr);

  function selectedNodes() { return tr.nodes(); }

  function setSelection(nodes) {
    tr.nodes(nodes);
  }

  function clear() {
    tr.nodes([]);
  }

  stage.on('click tap', (e) => {
    // Selection tool only
    if (getTool() !== 'select') return;

    // Clicked on empty stage → clear selection
    if (e.target === stage) {
      clear();
      return;
    }

    // Shapes live on the content layer. Walk up if a child of a group was hit.
    const node = nearestShape(e.target);
    if (!node) return;

    const current = tr.nodes();
    const meta = e.evt.shiftKey || e.evt.metaKey;

    if (meta) {
      if (current.includes(node)) setSelection(current.filter((n) => n !== node));
      else setSelection([...current, node]);
    } else {
      setSelection([node]);
    }
  });

  // Delete key removes the current selection
  const onKeyDown = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isTypingTarget(e.target)) return;
    const nodes = tr.nodes();
    if (!nodes.length) return;
    nodes.forEach((n) => n.destroy());
    clear();
  };
  window.addEventListener('keydown', onKeyDown);

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    tr.destroy();
  }

  return { selectedNodes, setSelection, clear, destroy };

  function nearestShape(node) {
    let n = node;
    while (n && n.getLayer() !== contentLayer) n = n.getParent();
    return n && n !== contentLayer ? n : null;
  }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}
