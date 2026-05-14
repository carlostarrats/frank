import assert from 'node:assert/strict';
import test from 'node:test';
import { attachTextEdit, editableTextNodeFor } from './text-edit.js';

test('editableTextNodeFor resolves standalone text and sticky text', () => {
  const standalone = fakeTextNode({ name: 'shape text' });
  assert.equal(editableTextNodeFor(standalone), standalone);

  const stickyText = fakeTextNode({ name: '' });
  const sticky = {
    getClassName: () => 'Group',
    name: () => 'shape sticky',
    findOne: () => stickyText,
  };
  assert.equal(editableTextNodeFor(sticky), stickyText);
});

test('attachTextEdit opens on click and commits edited text', () => {
  let appended = null;
  let committed = 0;
  globalThis.document = {
    createElement: () => fakeTextarea(),
  };

  const stage = {
    scaleX: () => 1,
    container: () => ({
      querySelector: () => null,
      appendChild: (el) => { appended = el; },
    }),
  };
  const textNode = fakeTextNode({ stage, text: 'Old' });
  const anchor = fakeAnchor();

  attachTextEdit(anchor, textNode, { onCommit: () => { committed += 1; } });
  anchor.handlers.click();
  assert.ok(appended, 'textarea should be appended on a normal click');

  appended.value = 'New';
  appended.listeners.blur();
  assert.equal(textNode.text(), 'New');
  assert.equal(committed, 1);

  delete globalThis.document;
});

function fakeAnchor() {
  return {
    handlers: {},
    on(events, handler) {
      for (const event of events.split(/\s+/)) this.handlers[event] = handler;
    },
  };
}

function fakeTextNode({ name = 'shape text', stage = null, text = 'Text' } = {}) {
  let currentText = text;
  return {
    getClassName: () => 'Text',
    name: () => name,
    getStage: () => stage,
    getAbsolutePosition: () => ({ x: 10, y: 20 }),
    text(value) {
      if (arguments.length) currentText = value;
      return currentText;
    },
    width: () => 120,
    fontSize: () => 18,
    fontFamily: () => 'monospace',
    fill: () => '#111',
    getLayer: () => ({ batchDraw() {} }),
  };
}

function fakeTextarea() {
  const textarea = {
    value: '',
    className: '',
    style: {},
    listeners: {},
    focus() {},
    select() {},
    remove() { this.removed = true; },
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  };
  return textarea;
}
