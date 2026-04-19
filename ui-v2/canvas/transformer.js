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

  // ── Marquee selection ──────────────────────────────────────────────────────
  // Drag a rectangle from empty canvas (Select tool only) to select every
  // shape whose bounding box intersects the marquee. The marquee lives on
  // the UI layer so it never persists into the canvas state. If the pointer
  // barely moves, we treat the interaction as a regular click and let the
  // click handler below handle it.
  let marquee = null;
  let marqueeStart = null;
  let didMarquee = false;

  function pointerContent() {
    return stage.getRelativePointerPosition() || { x: 0, y: 0 };
  }

  stage.on('mousedown.marquee', (e) => {
    if (getTool() !== 'select') return;
    // Normal mode: marquee only starts from empty stage. Crowded-canvas
    // escape hatch: Alt/Option-drag forces a marquee regardless of what
    // shape is under the cursor. Matches Figma / Sketch.
    const force = !!(e.evt && e.evt.altKey);
    if (e.target !== stage && !force) return;

    // If we're forcing a marquee over a shape, cancel any shape-drag Konva
    // would otherwise start so the drag belongs to the marquee alone.
    if (force && e.target !== stage) {
      if (typeof e.target.stopDrag === 'function') e.target.stopDrag();
      if (e.evt.preventDefault) e.evt.preventDefault();
    }

    marqueeStart = pointerContent();
    didMarquee = false;
    marquee = new Konva.Rect({
      x: marqueeStart.x,
      y: marqueeStart.y,
      width: 0,
      height: 0,
      stroke: '#60a5fa',
      strokeWidth: 1,
      dash: [4, 4],
      fill: 'rgba(96, 165, 250, 0.08)',
      listening: false,
      name: 'marquee',
    });
    uiLayer.add(marquee);
  });

  stage.on('mousemove.marquee', () => {
    if (!marquee || !marqueeStart) return;
    const p = pointerContent();
    const x = Math.min(marqueeStart.x, p.x);
    const y = Math.min(marqueeStart.y, p.y);
    const w = Math.abs(p.x - marqueeStart.x);
    const h = Math.abs(p.y - marqueeStart.y);
    marquee.position({ x, y });
    marquee.size({ width: w, height: h });
    if (w > 4 || h > 4) didMarquee = true;
    uiLayer.batchDraw();
  });

  function finalizeMarquee() {
    if (!marquee) return;
    const box = {
      x: marquee.x(),
      y: marquee.y(),
      width: marquee.width(),
      height: marquee.height(),
    };
    marquee.destroy();
    marquee = null;
    marqueeStart = null;
    uiLayer.batchDraw();

    // Decide purely from the marquee's final geometry — don't rely on the
    // `didMarquee` flag, because on real mouse input Konva fires `click`
    // before `mouseup` and the click handler clears the flag first.
    if (box.width <= 4 && box.height <= 4) return; // treat as click

    const hits = contentLayer.getChildren().filter((child) => {
      const r = child.getClientRect({ skipStroke: false, relativeTo: contentLayer });
      return !(r.x > box.x + box.width ||
               r.x + r.width < box.x ||
               r.y > box.y + box.height ||
               r.y + r.height < box.y);
    });
    setSelection(hits);
  }

  stage.on('mouseup.marquee', finalizeMarquee);

  // Fallback: if the user releases the mouse OUTSIDE the stage (dragged into
  // the drawer, over the inspector, or past the window edge), the stage's
  // mouseup never fires and the marquee is orphaned. A window-level mouseup
  // catches this and tears the marquee down.
  const onWindowMouseUp = () => finalizeMarquee();
  window.addEventListener('mouseup', onWindowMouseUp);

  // ── Connector hover halo ───────────────────────────────────────────────────
  // Thin lines are hard to aim at — Konva's 30px hitStrokeWidth makes them
  // clickable, but without a visual cue the user can't tell where the click
  // zone starts. On hover, add a subtle blue glow via shadow so the line
  // doesn't grow in stroke width (that fights with the properties inspector).
  // Only active with the select tool; other tools have their own hover cues.
  let hoveredConnector = null;
  stage.on('mouseover.connector-halo', (e) => {
    if (getTool() !== 'select') return;
    const node = nearestShape(e.target);
    if (!node) return;
    if (!(node.name() || '').includes('connector')) return;
    if (node === hoveredConnector) return;
    // Don't halo the currently-selected connector — the endpoint-edit mode
    // already gives it a stronger glow.
    if (currentHandlesOwner === node) return;
    hoveredConnector = node;
    node.shadowColor('#60a5fa');
    node.shadowBlur(6);
    node.shadowOpacity(0.6);
    node.shadowEnabled(true);
    contentLayer.batchDraw();
  });
  stage.on('mouseout.connector-halo', (e) => {
    if (!hoveredConnector) return;
    const node = nearestShape(e.target);
    if (node !== hoveredConnector) return;
    // Don't clear the glow if the connector is currently selected — the
    // endpoint-edit mode owns the shadow until deselection.
    if (currentHandlesOwner !== hoveredConnector) {
      hoveredConnector.shadowEnabled(false);
      hoveredConnector.shadowBlur(0);
      hoveredConnector.shadowOpacity(0);
    }
    hoveredConnector = null;
    contentLayer.batchDraw();
  });

  // Escape always cancels an in-progress marquee without selecting anything.
  const onMarqueeKey = (e) => {
    if (e.key !== 'Escape') return;
    if (!marquee) return;
    marquee.destroy();
    marquee = null;
    marqueeStart = null;
    didMarquee = false;
    uiLayer.batchDraw();
  };
  window.addEventListener('keydown', onMarqueeKey);

  stage.on('click tap', (e) => {
    // Selection tool only
    if (getTool() !== 'select') return;

    // Marquee-drag just completed — skip the "empty click = clear" branch.
    // Reset after consuming so the next real click on empty stage still
    // clears selection.
    if (didMarquee) { didMarquee = false; return; }

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
    if (marquee) { marquee.destroy(); marquee = null; }
    stage.off('mousedown.marquee mousemove.marquee mouseup.marquee');
    stage.off('mouseover.connector-halo mouseout.connector-halo');
    window.removeEventListener('mouseup', onWindowMouseUp);
    window.removeEventListener('keydown', onMarqueeKey);
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
