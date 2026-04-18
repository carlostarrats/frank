import { h } from './dom.js';

// Badge({ variant, text, children })
// variant: 'default' | 'outline' | 'destructive'  (default 'default')
export function Badge({ variant = 'default', text, children, class: className } = {}) {
  const kids = [];
  if (text) kids.push(text);
  if (children) kids.push(...(Array.isArray(children) ? children : [children]));
  return h('span', {
    class: `ui-badge${className ? ' ' + className : ''}`,
    dataset: { variant },
  }, kids);
}
