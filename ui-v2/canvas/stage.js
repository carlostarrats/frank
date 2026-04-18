// stage.js — Konva Stage + Layer setup, pan (space+drag), zoom (wheel).
//
// Konva is loaded globally via <script> tag in index.html, so we reference
// it as window.Konva. Keeping this file framework-free and build-step-free.

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.08;

export function createStage(container) {
  const Konva = window.Konva;

  const width = container.clientWidth;
  const height = container.clientHeight;

  const stage = new Konva.Stage({
    container,
    width,
    height,
  });

  const contentLayer = new Konva.Layer({ name: 'content' });
  const uiLayer = new Konva.Layer({ name: 'ui' });
  stage.add(contentLayer);
  stage.add(uiLayer);

  // ── Pan: spacebar hold → stage becomes draggable ──────────────────────────
  let panMode = false;
  const onKeyDown = (e) => {
    if (e.code === 'Space' && !panMode && !isTypingTarget(e.target)) {
      e.preventDefault();
      panMode = true;
      stage.draggable(true);
      container.style.cursor = 'grab';
    }
  };
  const onKeyUp = (e) => {
    if (e.code === 'Space' && panMode) {
      panMode = false;
      stage.draggable(false);
      container.style.cursor = '';
    }
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ── Zoom: wheel, relative to pointer ──────────────────────────────────────
  // Konva wraps DOM events: `e.evt` is the underlying WheelEvent.
  const onWheel = (e) => {
    const dom = e.evt;
    if (dom && typeof dom.preventDefault === 'function') dom.preventDefault();
    const deltaY = dom ? dom.deltaY : 0;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };

    const direction = deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * ZOOM_STEP : oldScale / ZOOM_STEP;
    const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));

    stage.scale({ x: clamped, y: clamped });
    stage.position({
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
  };
  stage.on('wheel', onWheel);

  // ── Resize handling ───────────────────────────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    stage.width(container.clientWidth);
    stage.height(container.clientHeight);
  });
  resizeObserver.observe(container);

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    resizeObserver.disconnect();
    stage.destroy();
  }

  function isPanning() { return panMode; }

  function resetView() {
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
  }

  return { stage, contentLayer, uiLayer, destroy, isPanning, resetView };
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || el.isContentEditable;
}
