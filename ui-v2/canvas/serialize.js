// serialize.js — Save/load canvas state via Konva's native JSON API.
//
// Konva.Stage.toJSON() captures the full tree including layers. To restore
// into an existing stage, we destroy the current content layer and rebuild
// from the stored JSON. The UI layer (transformer handles) is never persisted
// because we keep the transformer on a separate uiLayer.

import { rebindAll as rebindConnectors } from './connectors.js';
import { CONNECTOR_HIT_STROKE } from './shapes.js';
import { rehydrateImages } from './image.js';

export function serializeContent(contentLayer) {
  // Only persist the content layer's children. The stage size, UI layer, and
  // transformer are ephemeral UI state, not user content.
  return JSON.stringify({
    version: 1,
    children: contentLayer.children.map((c) => c.toObject()),
  });
}

export function deserializeInto(contentLayer, json) {
  const Konva = window.Konva;
  const parsed = typeof json === 'string' ? JSON.parse(json) : json;
  if (!parsed || !Array.isArray(parsed.children)) return;

  contentLayer.destroyChildren();
  for (const childDef of parsed.children) {
    const node = Konva.Node.create(JSON.stringify(childDef));
    if (!node) continue;
    contentLayer.add(node);
    // Re-enable draggable on restored shapes. Konva preserves the attr, but
    // older formats may drop it — enforce here for safety.
    if (typeof node.draggable === 'function') node.draggable(true);
    // Restored connectors from before the wide-hit-area fix don't have
    // hitStrokeWidth set; give them the same generous click zone as freshly
    // created ones so the "lines are hard to click" issue is fixed
    // retroactively.
    if ((node.name() || '').includes('connector') && typeof node.hitStrokeWidth === 'function') {
      node.hitStrokeWidth(CONNECTOR_HIT_STROKE);
    }
  }

  // Follow-shape connectors store sourceId/targetId on their attrs, which
  // survives round-trip. Walk the restored layer and rebuild the dragmove
  // listeners + per-layer connector index.
  rebindConnectors(contentLayer);

  // Konva.Image serializes attrs but not the `image` reference. Restored
  // images carry an `assetUrl` attr; re-fetch the HTMLImageElement async.
  rehydrateImages(contentLayer);
}
