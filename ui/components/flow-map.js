// flow-map.js — Visual connection graph

export function renderFlowMap(container, screens, { onSelectScreen }) {
  if (!screens || screens.length === 0) {
    container.innerHTML = '';
    return;
  }

  const NODE_W = 120;
  const NODE_H = 40;
  const GAP_X = 80;
  const PADDING = 24;

  // Build adjacency from connections
  const connected = new Set();
  const edges = [];

  screens.forEach(screen => {
    if (screen.connections) {
      Object.values(screen.connections).forEach(targetId => {
        if (screens.find(s => s.id === targetId)) {
          edges.push({ from: screen.id, to: targetId });
          connected.add(screen.id);
          connected.add(targetId);
        }
      });
    }
  });

  // Layout: place screens left to right in screenOrder
  const positions = {};
  let x = PADDING;
  const y = PADDING;

  screens.forEach(screen => {
    positions[screen.id] = { x, y };
    x += NODE_W + GAP_X;
  });

  // Calculate total dimensions
  const totalWidth = Math.max(x + PADDING, 200);
  const totalHeight = y + NODE_H + PADDING * 2;

  // Build SVG for arrows
  const arrowsSvg = edges.map(({ from, to }) => {
    const fromPos = positions[from];
    const toPos = positions[to];
    if (!fromPos || !toPos) return '';
    const x1 = fromPos.x + NODE_W;
    const y1 = fromPos.y + NODE_H / 2;
    const x2 = toPos.x;
    const y2 = toPos.y + NODE_H / 2;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="flow-map-arrow" />`;
  }).join('');

  // Build HTML nodes
  const nodesHtml = screens.map(screen => {
    const pos = positions[screen.id];
    const hasConnections = connected.has(screen.id);
    return `
      <div class="flow-map-node${hasConnections ? '' : ' flow-map-node--disconnected'}"
           data-screen-id="${escapeAttr(screen.id)}"
           style="left:${pos.x}px;top:${pos.y}px;width:${NODE_W}px;height:${NODE_H}px;">
        ${escapeHtml(screen.label || screen.id)}
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="flow-map" style="width:${totalWidth}px;height:${totalHeight}px;">
      <svg class="flow-map-svg" width="${totalWidth}" height="${totalHeight}">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)" />
          </marker>
        </defs>
        ${arrowsSvg}
      </svg>
      ${nodesHtml}
    </div>
  `;

  // Click handlers
  container.querySelectorAll('.flow-map-node').forEach(node => {
    node.addEventListener('click', () => onSelectScreen(node.dataset.screenId));
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
