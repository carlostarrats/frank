// export.js — Canvas export helpers: PNG (raster), SVG + PDF (vector), JSON.
//
// PNG stays raster via Konva's toDataURL — fine for quick screenshots.
// SVG and PDF are both vector: we translate the content layer to SVG once
// (svg-export.js) and either download it directly or hand it to svg2pdf.js
// for a vector PDF. No rasterized-PNG-in-PDF anymore (previous approach
// was shipping 10MB documents for simple canvases).

import { serializeContent } from './serialize.js';
import { buildSvg } from './svg-export.js';

const JSPDF_CDN = 'https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js';
const SVG2PDF_CDN = 'https://unpkg.com/svg2pdf.js@2.2.1/dist/svg2pdf.umd.min.js';
let jsPdfPromise = null;
let svg2PdfPromise = null;

function loadOnce(src, check) {
  return new Promise((resolve, reject) => {
    if (check()) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadJsPdfOnce() {
  if (!jsPdfPromise) jsPdfPromise = loadOnce(JSPDF_CDN, () => !!window.jspdf);
  return jsPdfPromise;
}

function loadSvg2PdfOnce() {
  if (!svg2PdfPromise) svg2PdfPromise = loadOnce(SVG2PDF_CDN, () => !!(window.svg2pdf || window.jspdf?.jsPDF?.prototype?.svg));
  return svg2PdfPromise;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadDataUrl(dataUrl, filename) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function safeFilename(name) {
  return (name || 'canvas').replace(/[^\w\-. ]+/g, '_').trim() || 'canvas';
}

// Hide UI overlays (Transformer handles, comment pins) during raster export.
function withUiHidden(uiLayer, fn) {
  const wasVisible = uiLayer.visible();
  uiLayer.visible(false);
  uiLayer.draw();
  try {
    return fn();
  } finally {
    uiLayer.visible(wasVisible);
    uiLayer.draw();
  }
}

// ─── PNG (raster) ───────────────────────────────────────────────────────────

export function exportPng({ stage, uiLayer, name }) {
  const dataUrl = withUiHidden(uiLayer, () =>
    stage.toDataURL({ pixelRatio: 2, mimeType: 'image/png' })
  );
  downloadDataUrl(dataUrl, `${safeFilename(name)}.png`);
}

// ─── SVG (vector) ───────────────────────────────────────────────────────────

export async function exportSvg({ contentLayer, name }) {
  const svg = await buildSvg(contentLayer);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, `${safeFilename(name)}.svg`);
}

// ─── PDF (vector via svg2pdf) ───────────────────────────────────────────────

export async function exportPdf({ contentLayer, name }) {
  await loadJsPdfOnce();
  await loadSvg2PdfOnce();
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('jsPDF not available');

  // Build the same SVG we'd export standalone, then pipe it through
  // svg2pdf's pdf.svg() plugin. Fully vector, small file size.
  const svgString = await buildSvg(contentLayer);
  const svgDoc = new DOMParser().parseFromString(svgString, 'image/svg+xml');
  const svgEl = svgDoc.documentElement;

  const width = parseFloat(svgEl.getAttribute('width') || '600');
  const height = parseFloat(svgEl.getAttribute('height') || '400');

  const orient = width >= height ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation: orient, unit: 'pt', format: [width, height] });

  // svg2pdf pdf.svg returns a Promise; await before saving.
  await pdf.svg(svgEl, { x: 0, y: 0, width, height });
  pdf.save(`${safeFilename(name)}.pdf`);
}

// ─── JSON (canvas state) ────────────────────────────────────────────────────

export function exportJson({ contentLayer, name }) {
  const json = serializeContent(contentLayer);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `${safeFilename(name)}.canvas.json`);
}
