import { h } from './dom.js';

// Card({ title, description, body, footer })
// Any of title/description/body/footer may be a string or a Node.
export function Card({ title, description, body, footer, class: className } = {}) {
  const kids = [];
  if (title || description) {
    const head = [];
    if (title) head.push(h('div', { class: 'ui-card-title' }, title));
    if (description) head.push(h('div', { class: 'ui-card-description' }, description));
    kids.push(h('div', { class: 'ui-card-header' }, head));
  }
  if (body) {
    kids.push(h('div', { class: 'ui-card-body' }, body instanceof Node ? body : [body]));
  }
  if (footer) {
    kids.push(h('div', { class: 'ui-card-footer' }, footer instanceof Node ? footer : [footer]));
  }
  return h('div', { class: `ui-card${className ? ' ' + className : ''}` }, kids);
}
