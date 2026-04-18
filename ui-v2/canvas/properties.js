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

    if (currentNodes.length === 0) {
      body.appendChild(h('div', { class: 'canvas-inspector-empty' }, ['Select a shape to edit its properties.']));
      return;
    }
    if (currentNodes.length > 1) {
      body.appendChild(h('div', { class: 'canvas-inspector-empty' },
        [`${currentNodes.length} shapes selected. Select one to see its properties.`]));
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

    // Z-order
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
