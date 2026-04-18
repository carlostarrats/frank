import { h } from './dom.js';

// Tabs({ tabs, defaultValue, onChange })
// tabs: [{ value, label, content: Node | string }]
export function Tabs({ tabs = [], defaultValue, onChange, class: className } = {}) {
  let active = defaultValue ?? tabs[0]?.value;

  const triggerButtons = new Map();
  const contentPanels = new Map();

  const list = h('div', { class: 'ui-tabs-list', role: 'tablist' },
    tabs.map((t) => {
      const btn = h('button', {
        class: 'ui-tabs-trigger',
        role: 'tab',
        type: 'button',
        dataset: { state: t.value === active ? 'active' : 'inactive' },
        onClick: () => setActive(t.value),
      }, [t.label]);
      triggerButtons.set(t.value, btn);
      return btn;
    }),
  );

  const panels = tabs.map((t) => {
    const panel = h('div', {
      class: 'ui-tabs-content',
      role: 'tabpanel',
      hidden: t.value !== active,
    }, t.content instanceof Node ? [t.content] : [t.content ?? '']);
    contentPanels.set(t.value, panel);
    return panel;
  });

  function setActive(value) {
    if (value === active) return;
    active = value;
    for (const [v, btn] of triggerButtons) btn.dataset.state = v === active ? 'active' : 'inactive';
    for (const [v, panel] of contentPanels) {
      if (v === active) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    if (onChange) onChange(active);
  }

  return h('div', { class: `ui-tabs${className ? ' ' + className : ''}` }, [list, ...panels]);
}
