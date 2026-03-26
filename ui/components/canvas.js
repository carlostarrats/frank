// canvas.js — Canvas background + zoom controls

const DEFAULT_BG = '#1e1e1e';
const DEFAULT_PADDING = 40;

let currentScale = 1;

export function createCanvas(container) {
  let bg = DEFAULT_BG;
  try { bg = localStorage.getItem('frank-canvas-bg') || DEFAULT_BG; } catch (e) { /* localStorage unavailable */ }

  container.innerHTML = `
    <div class="canvas" style="background: ${bg};">
      <div class="canvas-viewport">
        <div class="canvas-transform">
          <div class="canvas-content"></div>
        </div>
      </div>
    </div>
  `;

  const viewport = container.querySelector('.canvas-viewport');
  const transform = container.querySelector('.canvas-transform');
  const content = container.querySelector('.canvas-content');

  function setContent(html) {
    content.innerHTML = html;
    requestAnimationFrame(fitToWindow);
  }

  function fitToWindow() {
    const wfScreen = content.querySelector('.wf-device');
    if (!wfScreen) return;
    const wfWidth = wfScreen.offsetWidth;
    const wfHeight = wfScreen.offsetHeight;
    const vpWidth = viewport.clientWidth - DEFAULT_PADDING * 2;
    const vpHeight = viewport.clientHeight - DEFAULT_PADDING * 2;
    if (wfWidth === 0 || wfHeight === 0) return;
    currentScale = Math.min(vpWidth / wfWidth, vpHeight / wfHeight, 1);
    applyScale();
  }

  function setZoom(scale) {
    currentScale = Math.max(0.1, Math.min(3, scale));
    applyScale();
  }

  function zoomIn() { setZoom(currentScale + 0.1); }
  function zoomOut() { setZoom(currentScale - 0.1); }
  function zoomReset() { currentScale = 1; applyScale(); }

  function applyScale() {
    transform.style.transform = `scale(${currentScale})`;
    transform.style.transformOrigin = 'top center';
  }

  function getScale() { return currentScale; }

  window.addEventListener('resize', fitToWindow);

  return { setContent, fitToWindow, setZoom, zoomIn, zoomOut, zoomReset, getScale, content };
}
