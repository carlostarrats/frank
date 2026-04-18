import { h } from './dom.js';

export function Label({ htmlFor, text, children, class: className } = {}) {
  const kids = [];
  if (text) kids.push(text);
  if (children) kids.push(...(Array.isArray(children) ? children : [children]));
  return h('label', {
    class: `ui-label${className ? ' ' + className : ''}`,
    for: htmlFor,
  }, kids);
}
