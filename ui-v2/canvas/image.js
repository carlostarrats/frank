// image.js — Drag-and-drop images onto the canvas.
//
// Flow:
//   1. DOM drop event fires on the Konva stage container.
//   2. Read image bytes as base64.
//   3. Upload as an asset via the daemon; daemon stores under
//      ~/.frank/projects/{id}/assets/ and returns a /files/ URL.
//   4. Load the returned URL as an HTMLImageElement.
//   5. Create a Konva.Image centered on the drop point, store the asset URL
//      on a custom `assetUrl` attr (survives stage.toJSON()).
//
// Serialization note: Konva.Image serializes attrs but not the `image`
// reference — see rehydrateImages() below, which re-fetches HTMLImageElement
// from `assetUrl` after a deserialize pass.

import sync from '../core/sync.js';
import projectManager from '../core/project.js';

const ACCEPTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_CANVAS_DIM = 800;

export function attachImageDrop(container, contentLayer, { onCommit, getStage } = {}) {
  const stage = getStage ? getStage() : contentLayer.getStage();

  const onDragEnter = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    container.classList.add('canvas-stage-dragover');
  };
  const onDragOver = (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e) => {
    // Only clear when leaving the container itself, not a child.
    if (e.target === container) container.classList.remove('canvas-stage-dragover');
  };
  const onDrop = async (e) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    container.classList.remove('canvas-stage-dragover');
    const files = Array.from(e.dataTransfer.files || []).filter(f => ACCEPTED_IMAGE_MIME.includes(f.type));
    if (files.length === 0) return;

    const rect = container.getBoundingClientRect();
    const dropX = e.clientX - rect.left;
    const dropY = e.clientY - rect.top;
    const worldPt = screenToWorld(stage, dropX, dropY);

    let offset = 0;
    for (const file of files) {
      try {
        const node = await dropFile(file, worldPt.x + offset, worldPt.y + offset, contentLayer);
        if (node && onCommit) onCommit();
        offset += 24; // cascade multiple drops slightly
      } catch (err) {
        console.warn('[canvas:image] drop failed', err);
      }
    }
  };

  container.addEventListener('dragenter', onDragEnter);
  container.addEventListener('dragover', onDragOver);
  container.addEventListener('dragleave', onDragLeave);
  container.addEventListener('drop', onDrop);

  return () => {
    container.removeEventListener('dragenter', onDragEnter);
    container.removeEventListener('dragover', onDragOver);
    container.removeEventListener('dragleave', onDragLeave);
    container.removeEventListener('drop', onDrop);
  };
}

async function dropFile(file, x, y, contentLayer) {
  const projectId = projectManager.getId();
  if (!projectId) throw new Error('No active project');

  const data = await readAsBase64(file);
  const reply = await sync.uploadAsset(projectId, file.type, data);
  if (reply.type === 'error' || !reply.url) {
    throw new Error(reply.error || 'Upload failed');
  }

  const img = await loadImage(reply.url);
  const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, MAX_CANVAS_DIM);

  const Konva = window.Konva;
  const node = new Konva.Image({
    image: img,
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
    draggable: true,
    name: 'shape image',
    assetUrl: reply.url,
    assetId: reply.assetId,
  });
  contentLayer.add(node);
  contentLayer.batchDraw();
  return node;
}

// After deserializeInto completes, walk the layer and load HTMLImageElements
// for any Konva.Image nodes that persisted with just an assetUrl attr.
export function rehydrateImages(contentLayer) {
  const nodes = contentLayer.find('Image');
  for (const node of nodes) {
    if (node.image && node.image()) continue;
    const url = node.getAttr('assetUrl');
    if (!url) continue;
    loadImage(url).then((img) => {
      node.image(img);
      contentLayer.batchDraw();
    }).catch((err) => console.warn('[canvas:image] rehydrate failed', err));
  }
}

function hasFiles(dt) {
  if (!dt) return false;
  if (dt.types && Array.from(dt.types).includes('Files')) return true;
  return false;
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = typeof result === 'string' ? result.indexOf(',') : -1;
      if (comma < 0) return reject(new Error('Could not read image bytes'));
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image at ${url}`));
    img.src = url;
  });
}

function screenToWorld(stage, sx, sy) {
  const scale = stage.scaleX() || 1;
  return {
    x: (sx - stage.x()) / scale,
    y: (sy - stage.y()) / scale,
  };
}

function fitWithin(w, h, max) {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = Math.min(max / w, max / h);
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
