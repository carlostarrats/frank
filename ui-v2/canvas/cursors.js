// cursors.js — SVG data-URL cursors for every creation tool.
//
// Each cursor is a small 32×32 SVG with a hotspot in the top-left (where the
// click actually lands) and a miniature of the shape offset to the lower
// right so the user can see at-a-glance what's about to be placed. Drag
// tools (rectangle, circle, pen, connectors) show just the shape. Click
// tools (triangle, star, sticky, cloud, etc.) add a small plus sign next
// to the shape so the affordance reads as "click to drop".
//
// Shapes are rendered with a black outline plus a white halo so the cursor
// stays legible against any canvas background (dark or light).

const HOTSPOT_X = 2;
const HOTSPOT_Y = 2;

const PLUS_OVERLAY = `
  <g transform="translate(22,10)">
    <path d="M0 -4 L0 4 M-4 0 L4 0" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <path d="M0 -4 L0 4 M-4 0 L4 0" fill="none" stroke="black" stroke-width="1.5" stroke-linecap="round"/>
  </g>
`;

// Every shape draws with a white stroke to stand out on a dark canvas, with
// a black outline halo so it also reads against light backgrounds.
function outlined(shapePath) {
  return `
    <g stroke-linejoin="round" stroke-linecap="round">
      ${shapePath.replace('{STROKE}', 'black').replace('{WIDTH}', '3')}
      ${shapePath.replace('{STROKE}', 'white').replace('{WIDTH}', '1.5')}
    </g>
  `;
}

function cursorUrl(svgBody, hotspot = [HOTSPOT_X, HOTSPOT_Y]) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${CROSSHAIR_GLYPH}${svgBody}</svg>`;
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `url("data:image/svg+xml,${encoded}") ${hotspot[0]} ${hotspot[1]}, crosshair`;
}

// Small crosshair anchored at the hotspot so the user always sees the click
// origin regardless of what shape icon sits next to it.
const CROSSHAIR_GLYPH = `
  <g>
    <path d="M2 0 L2 6 M0 2 L6 2" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <path d="M2 0 L2 6 M0 2 L6 2" stroke="black" stroke-width="1.5" stroke-linecap="round"/>
  </g>
`;

// Drag tools: shape icon only.
const CIRCLE_ICON = outlined(`<circle cx="18" cy="14" r="7" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const RECTANGLE_ICON = outlined(`<rect x="11" y="8" width="16" height="12" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const FREEHAND_ICON = outlined(`<path d="M10 22 Q15 10 20 18 T28 14" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const ARROW_ICON = outlined(`<path d="M10 22 L26 10 M26 10 L21 11 M26 10 L25 15" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const ELBOW_ICON = outlined(`<path d="M10 22 L10 12 L26 12" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);

// Click-to-place shapes: icon + plus sign.
const TRIANGLE_ICON = outlined(`<path d="M18 7 L26 20 L10 20 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const DIAMOND_ICON = outlined(`<path d="M18 6 L27 14 L18 22 L9 14 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const HEXAGON_ICON = outlined(`<path d="M13 8 L23 8 L28 15 L23 22 L13 22 L8 15 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const STAR_ICON = outlined(`<path d="M18 7 L20 13 L27 13 L21.5 17 L23.5 24 L18 19.5 L12.5 24 L14.5 17 L9 13 L16 13 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const CLOUD_ICON = outlined(`<path d="M13 20 Q9 20 9 16 Q9 12 13 12 Q14 8 18 9 Q22 7 24 11 Q28 11 28 15 Q28 20 24 20 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const SPEECH_ICON = outlined(`<path d="M10 9 L26 9 L26 18 L18 18 L14 22 L14 18 L10 18 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const DOCUMENT_ICON = outlined(`<path d="M11 8 L22 8 L27 13 L27 23 L11 23 Z M22 8 L22 13 L27 13" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const CYLINDER_ICON = outlined(`<path d="M10 10 L10 20 Q10 22 18 22 Q26 22 26 20 L26 10 Q26 8 18 8 Q10 8 10 10 Q10 12 18 12 Q26 12 26 10" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const PARALLELOGRAM_ICON = outlined(`<path d="M14 9 L28 9 L22 21 L8 21 Z" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}"/>`);
const STICKY_ICON = outlined(`<rect x="11" y="9" width="16" height="14" fill="none" stroke="{STROKE}" stroke-width="{WIDTH}" rx="1"/>`);

function withPlus(icon) { return icon + PLUS_OVERLAY; }

// Exported registry — tool id → CSS cursor value.
export const TOOL_CURSORS = {
  select: 'default',

  // Drag tools — just the shape.
  rectangle: cursorUrl(RECTANGLE_ICON),
  circle:    cursorUrl(CIRCLE_ICON),
  freehand:  cursorUrl(FREEHAND_ICON),
  arrow:     cursorUrl(ARROW_ICON),
  elbow:     cursorUrl(ELBOW_ICON),

  // Click-to-place tools — shape + plus.
  triangle:      cursorUrl(withPlus(TRIANGLE_ICON)),
  diamond:       cursorUrl(withPlus(DIAMOND_ICON)),
  hexagon:       cursorUrl(withPlus(HEXAGON_ICON)),
  star:          cursorUrl(withPlus(STAR_ICON)),
  cloud:         cursorUrl(withPlus(CLOUD_ICON)),
  speech:        cursorUrl(withPlus(SPEECH_ICON)),
  document:      cursorUrl(withPlus(DOCUMENT_ICON)),
  cylinder:      cursorUrl(withPlus(CYLINDER_ICON)),
  parallelogram: cursorUrl(withPlus(PARALLELOGRAM_ICON)),
  sticky:        cursorUrl(withPlus(STICKY_ICON)),

  // Text uses the native text cursor — icon wouldn't add anything.
  text: 'text',
};

// Comment-mode cursor: plain crosshair. Consistent across canvas, viewer,
// and the reviewer overlay — "click anywhere to drop a comment." Previously
// this was a compound speech-bubble + plus SVG, but it reads as "pick a
// thing" on DOM surfaces (paired with the hover dashed outline), which made
// the commenting UX surface-dependent. Crosshair keeps the affordance
// uniform: no selection, no highlight, just click-where-you-want.
export const COMMENT_CURSOR = 'crosshair';
