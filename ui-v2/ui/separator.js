import { h } from './dom.js';

export function Separator({ orientation = 'horizontal', class: className } = {}) {
  return h('hr', {
    class: `ui-separator${className ? ' ' + className : ''}`,
    dataset: { orientation },
    role: 'separator',
  });
}
