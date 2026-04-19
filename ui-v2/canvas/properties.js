// properties.js — Right-side inspector for the selected Konva node.
//
// Mount once, then call setSelection(nodes) whenever the Transformer's
// selection changes. The inspector renders different controls depending on:
//   * no selection / multi-selection  → hint message
//   * single shape                     → fill, stroke, stroke width, opacity,
//                                         font size (text only), z-ordering
//   * template group                   → all of the above + "Dissolve group"
//
// Built from the shadcn primitives in ui-v2/ui/ so the inspector stays
// visually consistent with the rest of the app.

import { Button } from '../ui/button.js';
import { Input } from '../ui/input.js';
import { Label } from '../ui/label.js';
import { Separator } from '../ui/separator.js';
import { h } from '../ui/dom.js';
import { dissolveGroup } from './templates.js';

export function createInspector({ host, onChange }) {
  host.innerHTML = `
    <div class="canvas-inspector">
      <div class="canvas-inspector-header">
        <div class="canvas-inspector-title">Properties</div>
      </div>
      <div class="canvas-inspector-body" id="inspector-body">
        <div class="canvas-inspector-empty">Select a shape to edit its properties.</div>
      </div>
    </div>
  `;
  const body = host.querySelector('#inspector-body');

  let currentNodes = [];

  function setSelection(nodes) {
    currentNodes = nodes;
    render();
  }

  function render() {
    body.innerHTML = '';

    // Empty selection — nothing to render. The host sidebar is hidden by
    // .canvas-inspector-host (no `.open`), so the user never sees an empty
    // state. Skipping the hint message keeps the panel clean if the host
    // is briefly visible during the render.
    if (currentNodes.length === 0) return;
    if (currentNodes.length > 1) {
      body.appendChild(h('div', { class: 'canvas-inspector-multi-label' },
        [`${currentNodes.length} shapes selected`]));
      body.appendChild(alignmentGrid(currentNodes, onChange));
      return;
    }

    const node = currentNodes[0];
    const isGroup = node.getClassName() === 'Group';
    const isTemplateGroup = isGroup && (node.name() || '').includes('template-group');
    const textNode = resolveTextNode(node);

    // Fill
    if (hasFill(node)) {
      body.appendChild(colorField({
        label: 'Fill',
        value: asColor(node.fill()),
        onChange: (val) => { applyColor(node, 'fill', val); onChange?.(); },
      }));
    }

    // Stroke
    if (hasStroke(node)) {
      body.appendChild(colorField({
        label: 'Stroke',
        value: asColor(node.stroke()),
        onChange: (val) => { applyColor(node, 'stroke', val); onChange?.(); },
      }));

      body.appendChild(numberField({
        label: 'Stroke width',
        value: Math.round((node.strokeWidth?.() ?? 1) * 10) / 10,
        step: 0.5,
        min: 0,
        max: 20,
        onChange: (val) => {
          node.strokeWidth(val);
          node.getLayer()?.batchDraw();
          onChange?.();
        },
      }));
    }

    // Opacity
    body.appendChild(rangeField({
      label: 'Opacity',
      value: Math.round((node.opacity() ?? 1) * 100),
      min: 0,
      max: 100,
      step: 1,
      onChange: (val) => {
        node.opacity(val / 100);
        node.getLayer()?.batchDraw();
        onChange?.();
      },
    }));

    // Font size (only if the node contains a Text child we can edit)
    if (textNode) {
      body.appendChild(numberField({
        label: 'Font size',
        value: textNode.fontSize?.() ?? 14,
        min: 8,
        max: 96,
        step: 1,
        onChange: (val) => {
          textNode.fontSize(val);
          textNode.getLayer()?.batchDraw();
          onChange?.();
        },
      }));
    }

    body.appendChild(Separator());

    // Positioning (z-order)
    body.appendChild(h('div', { class: 'canvas-inspector-subhead' }, ['Positioning']));
    const zRow = h('div', { class: 'canvas-inspector-row canvas-inspector-buttons' },
      [
        Button({
          variant: 'secondary', size: 'sm', text: 'Forward',
          onClick: () => { node.moveUp(); node.getLayer()?.batchDraw(); onChange?.(); },
        }),
        Button({
          variant: 'secondary', size: 'sm', text: 'Backward',
          onClick: () => { node.moveDown(); node.getLayer()?.batchDraw(); onChange?.(); },
        }),
        Button({
          variant: 'secondary', size: 'sm', text: 'To front',
          onClick: () => { node.moveToTop(); node.getLayer()?.batchDraw(); onChange?.(); },
        }),
        Button({
          variant: 'secondary', size: 'sm', text: 'To back',
          onClick: () => { node.moveToBottom(); node.getLayer()?.batchDraw(); onChange?.(); },
        }),
      ],
    );
    body.appendChild(zRow);

    body.appendChild(Separator());

    if (isTemplateGroup) {
      body.appendChild(Button({
        variant: 'outline',
        size: 'sm',
        text: 'Dissolve group',
        onClick: () => {
          const layer = node.getLayer();
          dissolveGroup(node, layer);
          setSelection([]);
          onChange?.();
        },
      }));
    }

    body.appendChild(Button({
      variant: 'destructive',
      size: 'sm',
      text: 'Delete shape',
      onClick: () => {
        const layer = node.getLayer();
        node.destroy();
        layer?.batchDraw();
        setSelection([]);
        onChange?.();
      },
    }));
  }

  return { setSelection };
}

// ── Alignment (multi-selection) ──────────────────────────────────────────────
//
// Six buttons: horizontal (left / center / right) and vertical (top / middle /
// bottom). Each icon visually depicts the alignment operation. The align
// math uses getClientRect so rotation and scale are honored — `node.x()`
// alone would misalign rotated shapes whose rendered bounds don't match
// their origin.

function alignmentGrid(nodes, onChange) {
  const layer = nodes[0]?.getLayer();
  if (!layer) return h('div', {}, []);

  function align(axis, mode) {
    // axis: 'h' (horizontal = align by X) or 'v' (vertical = align by Y)
    // mode: 'start' | 'center' | 'end'
    const rects = nodes.map((n) => ({
      node: n,
      rect: n.getClientRect({ relativeTo: layer }),
    }));
    // Compute the alignment target (the common edge or axis).
    let target;
    if (axis === 'h') {
      if (mode === 'start')  target = Math.min(...rects.map((r) => r.rect.x));
      if (mode === 'center') {
        const minX = Math.min(...rects.map((r) => r.rect.x));
        const maxX = Math.max(...rects.map((r) => r.rect.x + r.rect.width));
        target = (minX + maxX) / 2;
      }
      if (mode === 'end')    target = Math.max(...rects.map((r) => r.rect.x + r.rect.width));
    } else {
      if (mode === 'start')  target = Math.min(...rects.map((r) => r.rect.y));
      if (mode === 'center') {
        const minY = Math.min(...rects.map((r) => r.rect.y));
        const maxY = Math.max(...rects.map((r) => r.rect.y + r.rect.height));
        target = (minY + maxY) / 2;
      }
      if (mode === 'end')    target = Math.max(...rects.map((r) => r.rect.y + r.rect.height));
    }
    // Move each node so its relevant edge/axis lands on `target`. Because
    // getClientRect may differ from node.x()/y() (rotation, self-rect
    // offset), adjust by the delta between current rect edge and target.
    for (const { node, rect } of rects) {
      let dx = 0, dy = 0;
      if (axis === 'h') {
        if (mode === 'start')  dx = target - rect.x;
        if (mode === 'center') dx = target - (rect.x + rect.width / 2);
        if (mode === 'end')    dx = target - (rect.x + rect.width);
      } else {
        if (mode === 'start')  dy = target - rect.y;
        if (mode === 'center') dy = target - (rect.y + rect.height / 2);
        if (mode === 'end')    dy = target - (rect.y + rect.height);
      }
      node.x(node.x() + dx);
      node.y(node.y() + dy);
    }
    layer.batchDraw();
    onChange?.();
  }

  const row = (label, buttons) =>
    h('div', { class: 'canvas-align-row' }, [
      h('div', { class: 'canvas-align-label' }, [label]),
      h('div', { class: 'canvas-align-buttons' }, buttons),
    ]);

  return h('div', { class: 'canvas-align-grid' }, [
    row('Horizontal', [
      alignButton('Align left',   alignIcon('h', 'start'),  () => align('h', 'start')),
      alignButton('Align center', alignIcon('h', 'center'), () => align('h', 'center')),
      alignButton('Align right',  alignIcon('h', 'end'),    () => align('h', 'end')),
    ]),
    row('Vertical', [
      alignButton('Align top',    alignIcon('v', 'start'),  () => align('v', 'start')),
      alignButton('Align middle', alignIcon('v', 'center'), () => align('v', 'center')),
      alignButton('Align bottom', alignIcon('v', 'end'),    () => align('v', 'end')),
    ]),
  ]);
}

function alignButton(title, iconSvg, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'canvas-align-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.innerHTML = iconSvg;
  btn.addEventListener('click', onClick);
  return btn;
}

// Inline-SVG icons that visually depict the alignment. The dashed
// "guide" is the axis all shapes collapse to; the filled rectangles
// are the shapes being aligned, sitting flush with that guide.
// 24×24 viewbox, currentColor stroke.
function alignIcon(axis, mode) {
  const guide = (x1, y1, x2, y2) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2" />`;
  const rect = (x, y, w, h) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" fill="currentColor" />`;

  if (axis === 'h') {
    // Horizontal alignment: vertical guide, shapes line up against it.
    if (mode === 'start')
      return svg(guide(4, 3, 4, 21) + rect(4, 6, 10, 4) + rect(4, 14, 14, 4));
    if (mode === 'center')
      return svg(guide(12, 3, 12, 21) + rect(7, 6, 10, 4) + rect(5, 14, 14, 4));
    if (mode === 'end')
      return svg(guide(20, 3, 20, 21) + rect(10, 6, 10, 4) + rect(6, 14, 14, 4));
  } else {
    // Vertical alignment: horizontal guide, shapes line up under/above.
    if (mode === 'start')
      return svg(guide(3, 4, 21, 4) + rect(6, 4, 4, 10) + rect(14, 4, 4, 14));
    if (mode === 'center')
      return svg(guide(3, 12, 21, 12) + rect(6, 7, 4, 10) + rect(14, 5, 4, 14));
    if (mode === 'end')
      return svg(guide(3, 20, 21, 20) + rect(6, 10, 4, 10) + rect(14, 6, 4, 14));
  }
  return '';
}

function svg(body) {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${body}</svg>`;
}

// ── Field builders ───────────────────────────────────────────────────────────

function colorField({ label, value, onChange }) {
  let swatchInput;
  let textInput;
  const row = h('div', { class: 'canvas-inspector-row' }, [
    Label({ text: label }),
    h('div', { class: 'canvas-inspector-color-input' }, [
      h('input', {
        type: 'color',
        class: 'canvas-inspector-swatch',
        value: value.hex,
        ref: (el) => { swatchInput = el; },
        onInput: (e) => {
          const next = e.target.value;
          if (textInput) textInput.value = next;
          onChange(next);
        },
      }),
      Input({
        value: value.hex,
        onInput: (e) => {
          const next = e.target.value.trim();
          if (swatchInput && /^#[0-9a-fA-F]{6}$/.test(next)) swatchInput.value = next;
          onChange(next);
        },
        ref: (el) => { textInput = el; },
      }),
    ]),
  ]);
  return row;
}

function numberField({ label, value, min, max, step, onChange }) {
  const row = h('div', { class: 'canvas-inspector-row' }, [
    Label({ text: label }),
    Input({
      type: 'number',
      value: String(value),
      onChange: (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) onChange(v);
      },
    }),
  ]);
  const input = row.querySelector('input');
  if (input) {
    if (min != null) input.min = String(min);
    if (max != null) input.max = String(max);
    if (step != null) input.step = String(step);
  }
  return row;
}

function rangeField({ label, value, min, max, step, onChange }) {
  const valueEl = h('span', { class: 'canvas-inspector-range-value' }, [`${value}%`]);
  const row = h('div', { class: 'canvas-inspector-row' }, [
    h('div', { class: 'canvas-inspector-range-label' }, [Label({ text: label }), valueEl]),
    h('input', {
      type: 'range',
      class: 'canvas-inspector-range',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      onInput: (e) => {
        const v = parseFloat(e.target.value);
        if (!Number.isNaN(v)) {
          valueEl.textContent = `${Math.round(v)}%`;
          onChange(v);
        }
      },
    }),
  ]);
  return row;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hasFill(node) {
  return typeof node.fill === 'function' && node.fill != null;
}

function hasStroke(node) {
  return typeof node.stroke === 'function' && node.stroke != null;
}

function resolveTextNode(node) {
  if (!node) return null;
  if (node.getClassName() === 'Text') return node;
  if (node._stickyText) return node._stickyText;
  // Group containing a single Text child
  if (typeof node.getChildren === 'function') {
    const children = node.getChildren();
    const text = children.find((c) => c.getClassName() === 'Text');
    if (text) return text;
  }
  return null;
}

function applyColor(node, attr, val) {
  if (!/^#[0-9a-fA-F]{6}$/.test(val) && !/^rgba?\(/.test(val)) return;
  node[attr](val);
  node.getLayer()?.batchDraw();
}

function asColor(val) {
  if (typeof val !== 'string') return { hex: '#ffffff', raw: val };
  if (/^#[0-9a-fA-F]{6}$/.test(val)) return { hex: val.toLowerCase(), raw: val };
  // For rgba/named colors, keep the raw value in the text input but default
  // the picker to white so it doesn't show stale data.
  return { hex: '#ffffff', raw: val };
}
