import { h, onDismiss } from './dom.js';

// DropdownMenu({ trigger, items })
// `trigger` is the button element the menu anchors to (must be in the DOM
// before open()). `items` is an array of:
//   { type: 'item', label, onSelect, disabled, icon }
//   { type: 'separator' }
//
// Returns { node: trigger, open, close }. The trigger is also given a click
// handler that toggles the menu. The menu is positioned below-left of the
// trigger; we keep placement dumb for v1 (no flip detection). Refactor if
// a menu ends up near a viewport edge.
export function DropdownMenu({ trigger, items = [], onClose } = {}) {
  let menu = null;
  let removeDismiss = () => {};

  function render() {
    return h('div', { class: 'ui-dropdown', role: 'menu' },
      items.map((item) => {
        if (item.type === 'separator') return h('div', { class: 'ui-dropdown-separator' });
        return h('div', {
          class: 'ui-dropdown-item',
          role: 'menuitem',
          dataset: { disabled: item.disabled ? 'true' : 'false' },
          onClick: () => {
            if (item.disabled) return;
            close();
            if (item.onSelect) item.onSelect();
          },
        }, [
          item.icon ? h('span', { class: 'ui-dropdown-icon' }, item.icon) : null,
          h('span', null, item.label),
        ]);
      }),
    );
  }

  function open() {
    if (menu) return;
    menu = render();
    document.body.appendChild(menu);
    const rect = trigger.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    removeDismiss = onDismiss(menu, (reason) => { if (reason !== 'keep') close(); });
  }

  function close() {
    if (!menu) return;
    removeDismiss();
    menu.remove();
    menu = null;
    if (onClose) onClose();
  }

  if (trigger) {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu ? close() : open();
    });
  }

  return { node: trigger, open, close };
}
