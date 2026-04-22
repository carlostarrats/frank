// zoom-menu.js — Shared zoom-level dropdown for canvas + image views.
//
// Replaces the click-to-reset zoom pill. A click on the percentage opens
// a small menu of fixed zoom levels; "Reset" runs the same fit-to-view
// logic the old click-to-reset had.
//
// Use:
//   const zoom = mountZoomMenu(hostEl, {
//     getZoom: () => currentZoomValue,  // 0–1+ where 1 = 100%
//     setZoom: (level) => { ... },      // 0.25, 0.5, 0.75, ... 2
//     onReset: () => { ... },           // fit-to-view
//   });
//   // Call zoom.update() after external zoom changes (e.g. wheel) to
//   // refresh the displayed percentage.

const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function mountZoomMenu(hostEl, { getZoom, setZoom, onReset }) {
  // Build the DOM once and reuse it — wheel zoom calls update() frequently,
  // so we want cheap updates (just the button text and active marker).
  hostEl.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'zoom-menu-wrapper';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-ghost canvas-zoom-reset zoom-menu-btn';
  btn.title = 'Zoom';
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', 'false');

  const menu = document.createElement('div');
  menu.className = 'zoom-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  const presetEls = [];
  for (const p of PRESETS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'zoom-menu-item';
    item.setAttribute('role', 'menuitem');
    item.dataset.level = String(p);
    item.textContent = `${Math.round(p * 100)}%`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      setZoom(p);
      update();
    });
    menu.appendChild(item);
    presetEls.push({ level: p, el: item });
  }

  const divider = document.createElement('div');
  divider.className = 'zoom-menu-divider';
  menu.appendChild(divider);

  const resetItem = document.createElement('button');
  resetItem.type = 'button';
  resetItem.className = 'zoom-menu-item';
  resetItem.setAttribute('role', 'menuitem');
  resetItem.textContent = 'Reset view';
  resetItem.addEventListener('click', (e) => {
    e.stopPropagation();
    closeMenu();
    onReset();
    update();
  });
  menu.appendChild(resetItem);

  let menuOpen = false;
  const openMenu = () => {
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    menuOpen = true;
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKeyDown);
  };
  const closeMenu = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    menuOpen = false;
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKeyDown);
  };
  const onDocClick = (ev) => {
    if (!wrapper.contains(ev.target)) closeMenu();
  };
  const onKeyDown = (ev) => {
    if (ev.key === 'Escape') { ev.stopPropagation(); closeMenu(); btn.focus(); }
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (menuOpen) closeMenu();
    else openMenu();
  });

  wrapper.appendChild(btn);
  wrapper.appendChild(menu);
  hostEl.appendChild(wrapper);

  function update() {
    const z = getZoom();
    btn.textContent = `${Math.round(z * 100)}%`;
    for (const { level, el } of presetEls) {
      el.classList.toggle('active', Math.abs(z - level) < 0.001);
    }
  }
  update();

  return { update };
}
