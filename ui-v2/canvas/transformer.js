// transformer.js — Selection and transform handles for canvas shapes.
//
// Single click on a shape selects it. Shift-click adds to selection. Click on
// empty stage clears. Konva.Transformer renders the move/resize/rotate handles
// on the UI layer, so it never gets serialized into the content state.
//
// When the selection is a single connector (arrow / elbow), we suppress the
// Transformer and surface endpoint handles instead — resize/rotate isn't a
// useful operation on a line, but dragging either end to re-attach is.

import { showConnectorHandles } from './endpoint-edit.js';

export function createSelection({ stage, contentLayer, uiLayer, getTool, onChange }) {
  const Konva = window.Konva;
  const tr = new Konva.Transformer({
    rotateAnchorOffset: 24,
    anchorSize: 9,
    anchorStrokeWidth: 1,
    borderStrokeWidth: 1,
    anchorCornerRadius: 2,
    // Free resize by default; Shift temporarily locks aspect ratio (see
    // shift-key listeners below). Matches Figma/Sketch convention.
    keepRatio: false,
  });
  uiLayer.add(tr);

  // Shift-to-lock-aspect-ratio during transformer resize.
  const onKeyToggle = (e) => {
    if (e.key === 'Shift') tr.keepRatio(e.type === 'keydown');
  };
  window.addEventListener('keydown', onKeyToggle);
  window.addEventListener('keyup', onKeyToggle);

  let currentHandles = null; // connector endpoint handles, or null

  function tearDownHandles() {
    if (currentHandles) { currentHandles.destroy(); currentHandles = null; }
  }

  function notify() {
    if (onChange) onChange(tr.nodes().length > 0 ? tr.nodes() : (currentHandles ? [currentHandlesOwner] : []));
  }

  let currentHandlesOwner = null;

  function selectedNodes() {
    if (tr.nodes().length) return tr.nodes();
    if (currentHandlesOwner) return [currentHandlesOwner];
    return [];
  }

  function setSelection(nodes) {
    tearDownHandles();
    currentHandlesOwner = null;

    // Single-connector special case: show endpoint handles instead of the
    // Transformer so the user can re-attach either end to a different shape.
    if (nodes.length === 1 && (nodes[0].name() || '').includes('connector')) {
      tr.nodes([]);
      currentHandlesOwner = nodes[0];
      currentHandles = showConnectorHandles(nodes[0], {
        stage,
        contentLayer,
        uiLayer,
        onChange: notify,
      });
    } else {
      tr.nodes(nodes);
    }
    notify();
  }

  function clear() {
    tearDownHandles();
    currentHandlesOwner = null;
    tr.nodes([]);
    notify();
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

    const shiftKey = e.evt.shiftKey || e.evt.metaKey;
    const altKey = e.evt.altKey;

    // Alt-click: cycle through overlapping shapes at the pointer. Find every
    // shape that intersects the click point, sorted by draw order (top-most
    // first), then pick the one *below* the currently-selected one. When
    // nothing is selected, alt-click behaves like a regular click.
    if (altKey) {
      const stack = shapesAtPointer(stage, contentLayer);
      if (stack.length > 1) {
        const current = tr.nodes()[0];
        const idx = current ? stack.indexOf(current) : -1;
        const next = stack[(idx + 1) % stack.length];
        setSelection([next]);
        return;
      }
    }

    if (shiftKey) {
      const current = tr.nodes();
      if (current.includes(node)) setSelection(current.filter((n) => n !== node));
      else setSelection([...current, node]);
    } else {
      setSelection([node]);
    }
  });

  // Returns all content-layer children whose bounding box contains the
  // current pointer position, top-most first. Used by alt-click cycling.
  function shapesAtPointer(stage, layer) {
    const pointer = stage.getPointerPosition();
    if (!pointer) return [];
    // Map pointer to layer-space (honoring pan/zoom).
    const transform = layer.getAbsoluteTransform().copy().invert();
    const p = transform.point(pointer);
    const hits = [];
    for (const child of layer.getChildren()) {
      const rect = child.getClientRect({ skipStroke: false, relativeTo: layer });
      if (p.x >= rect.x && p.x <= rect.x + rect.width &&
          p.y >= rect.y && p.y <= rect.y + rect.height) {
        hits.push(child);
      }
    }
    // Children appear in render order (bottom-first); reverse for top-first.
    return hits.reverse();
  }

  // Delete key removes the current selection (Transformer or connector).
  const onKeyDown = (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isTypingTarget(e.target)) return;
    const nodes = selectedNodes();
    if (!nodes.length) return;
    nodes.forEach((n) => n.destroy());
    clear();
  };
  window.addEventListener('keydown', onKeyDown);

  function destroy() {
    tearDownHandles();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keydown', onKeyToggle);
    window.removeEventListener('keyup', onKeyToggle);
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
