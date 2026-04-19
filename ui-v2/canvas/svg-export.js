// svg-export.js — Konva content layer → SVG string.
//
// Used by both exportSvg (standalone) and exportPdf (routed through
// svg2pdf.js for vector PDF output). Every Konva shape type used by the
// canvas gets its SVG counterpart here. Images are inlined as data URLs
// so the exported SVG is self-contained.
//
// Transforms: we flatten via getAbsoluteTransform() and emit each shape
// at its world position with a matrix() transform. This avoids having to
// mirror Konva's translate→rotate→scale→offset stack inside SVG.

const SVG_NS = 'http://www.w3.org/2000/svg';

export async function buildSvg(contentLayer, { padding = 24 } = {}) {
  const bounds = contentLayer.getClientRect();
  const minX = bounds.x - padding;
  const minY = bounds.y - padding;
  const width = Math.max(1, bounds.width + padding * 2);
  const height = Math.max(1, bounds.height + padding * 2);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  svg.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  svg.setAttribute('width', String(Math.round(width)));
  svg.setAttribute('height', String(Math.round(height)));

  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  const state = { defs, arrowMarkerIds: new Map() };

  for (const node of contentLayer.getChildren()) {
    await appendNode(svg, node, state);
  }
  if (!defs.hasChildNodes()) defs.remove();

  return new XMLSerializer().serializeToString(svg);
}

async function appendNode(parent, node, state) {
  const cls = node.getClassName();
  if (cls === 'Transformer') return;   // UI chrome
  if (cls === 'Group') {
    const g = el('g', { transform: matrixAttr(node) });
    for (const child of node.getChildren()) await appendNode(g, child, state);
    if (g.hasChildNodes()) parent.appendChild(g);
    return;
  }

  const em = await buildShape(cls, node, state);
  if (em) {
    em.setAttribute('transform', matrixAttr(node));
    applyStyle(em, node, cls);
    parent.appendChild(em);
  }
}

// ─── Per-shape SVG builders ─────────────────────────────────────────────────

async function buildShape(cls, node, state) {
  switch (cls) {
    case 'Rect': {
      const r = el('rect', {
        x: '0', y: '0',
        width: String(node.width() || 0),
        height: String(node.height() || 0),
      });
      const corner = node.cornerRadius?.() ?? 0;
      if (corner) { r.setAttribute('rx', String(corner)); r.setAttribute('ry', String(corner)); }
      return r;
    }
    case 'Circle': {
      return el('circle', { cx: '0', cy: '0', r: String(node.radius() || 0) });
    }
    case 'Ellipse': {
      return el('ellipse', {
        cx: '0', cy: '0',
        rx: String(node.radiusX?.() || 0),
        ry: String(node.radiusY?.() || 0),
      });
    }
    case 'RegularPolygon': {
      const sides = node.sides?.() || 3;
      const radius = node.radius?.() || 0;
      const pts = [];
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i / sides) * Math.PI * 2;
        pts.push(`${Math.cos(a) * radius},${Math.sin(a) * radius}`);
      }
      return el('polygon', { points: pts.join(' ') });
    }
    case 'Star': {
      const n = node.numPoints?.() || 5;
      const outerR = node.outerRadius?.() || 0;
      const innerR = node.innerRadius?.() || 0;
      const pts = [];
      for (let i = 0; i < n * 2; i++) {
        const a = -Math.PI / 2 + (i / (n * 2)) * Math.PI * 2;
        const r = (i % 2 === 0) ? outerR : innerR;
        pts.push(`${Math.cos(a) * r},${Math.sin(a) * r}`);
      }
      return el('polygon', { points: pts.join(' ') });
    }
    case 'Path': {
      // Konva stores the SVG-compatible 'data' attr verbatim.
      const d = node.data?.();
      if (!d) return null;
      return el('path', { d });
    }
    case 'Line': {
      const points = node.points?.() || [];
      if (points.length < 2) return null;
      const pairs = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        pairs.push(`${points[i]},${points[i + 1]}`);
      }
      const closed = !!node.closed?.();
      return el(closed ? 'polygon' : 'polyline', { points: pairs.join(' ') });
    }
    case 'Arrow': {
      const points = node.points?.() || [];
      if (points.length < 4) return null;
      const pairs = [];
      for (let i = 0; i + 1 < points.length; i += 2) {
        pairs.push(`${points[i]},${points[i + 1]}`);
      }
      // Arrow head via marker-end; fill defaults to node.fill() or stroke.
      const headColor = node.fill?.() || node.stroke?.() || '#000';
      const markerId = ensureArrowMarker(state, headColor);
      const line = el('polyline', { points: pairs.join(' '), 'marker-end': `url(#${markerId})` });
      return line;
    }
    case 'Text': {
      const text = node.text?.() || '';
      const fontSize = node.fontSize?.() || 14;
      const fontFamily = node.fontFamily?.() || 'sans-serif';
      const fontStyle = node.fontStyle?.() || '';
      const lineHeight = node.lineHeight?.() || 1;
      const t = el('text', {
        x: '0',
        y: String(fontSize),     // SVG text y is baseline; offset so the box top aligns
        'font-family': fontFamily,
        'font-size': String(fontSize),
      });
      if (/bold/i.test(fontStyle)) t.setAttribute('font-weight', 'bold');
      if (/italic/i.test(fontStyle)) t.setAttribute('font-style', 'italic');
      const lines = String(text).split('\n');
      if (lines.length === 1) {
        t.textContent = lines[0];
      } else {
        for (let i = 0; i < lines.length; i++) {
          const tspan = el('tspan', {
            x: '0',
            dy: i === 0 ? '0' : `${fontSize * lineHeight}`,
          });
          tspan.textContent = lines[i];
          t.appendChild(tspan);
        }
      }
      return t;
    }
    case 'Image': {
      const w = node.width?.() || 0;
      const h = node.height?.() || 0;
      const url = node.getAttr?.('assetUrl') || node.image?.()?.src || '';
      if (!url) return null;
      // Inline as data URL so the SVG is portable outside this daemon.
      const href = await toDataUrl(url).catch(() => url);
      const img = el('image', { x: '0', y: '0', width: String(w), height: String(h) });
      img.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
      img.setAttribute('href', href);
      return img;
    }
    default:
      return null; // Unknown class (including Transformer) skipped cleanly
  }
}

// ─── Style application ──────────────────────────────────────────────────────

function applyStyle(svgEl, node, cls) {
  const fill = node.fill?.();
  const stroke = node.stroke?.();
  const strokeWidth = node.strokeWidth?.();
  const dash = node.dash?.();
  const opacity = node.opacity?.();

  if (cls === 'Text') {
    svgEl.setAttribute('fill', fill || '#000');
    if (opacity != null && opacity < 1) svgEl.setAttribute('opacity', String(opacity));
    return;
  }

  if (cls === 'Image') {
    if (opacity != null && opacity < 1) svgEl.setAttribute('opacity', String(opacity));
    return;
  }

  if (cls === 'Line' || cls === 'Arrow') {
    svgEl.setAttribute('fill', 'none');
  } else {
    svgEl.setAttribute('fill', fill || 'none');
  }
  if (stroke) svgEl.setAttribute('stroke', stroke);
  if (strokeWidth != null) svgEl.setAttribute('stroke-width', String(strokeWidth));
  if (Array.isArray(dash) && dash.length > 0) {
    svgEl.setAttribute('stroke-dasharray', dash.join(','));
  }
  if (opacity != null && opacity < 1) svgEl.setAttribute('opacity', String(opacity));
}

function ensureArrowMarker(state, color) {
  const cached = state.arrowMarkerIds.get(color);
  if (cached) return cached;
  const id = `arrowhead-${state.arrowMarkerIds.size}`;
  const marker = el('marker', {
    id,
    viewBox: '0 0 10 10',
    refX: '9',
    refY: '5',
    markerWidth: '8',
    markerHeight: '8',
    orient: 'auto-start-reverse',
  });
  const path = el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color });
  marker.appendChild(path);
  state.defs.appendChild(marker);
  state.arrowMarkerIds.set(color, id);
  return id;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function el(tag, attrs = {}) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) e.setAttribute(k, String(v));
  }
  return e;
}

function matrixAttr(node) {
  const m = node.getAbsoluteTransform().m;
  // Konva's matrix is [a, b, c, d, e, f] — same order as SVG matrix().
  return `matrix(${m[0]} ${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]})`;
}

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
