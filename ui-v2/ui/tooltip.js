import { h } from './dom.js';

// Tooltip(triggerEl, { label, placement })
// Attaches hover/focus listeners to triggerEl; shows a tooltip bubble on
// delay. Returns a teardown function that removes the listeners.
export function Tooltip(trigger, { label, delay = 250, placement = 'top' } = {}) {
  let tip = null;
  let timer = null;

  function show() {
    if (tip) return;
    tip = h('div', { class: 'ui-tooltip', role: 'tooltip' }, [label]);
    document.body.appendChild(tip);
    const rect = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    let left, top;
    if (placement === 'top') {
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      top = rect.top - tipRect.height - 6;
    } else if (placement === 'bottom') {
      left = rect.left + rect.width / 2 - tipRect.width / 2;
      top = rect.bottom + 6;
    } else if (placement === 'left') {
      left = rect.left - tipRect.width - 6;
      top = rect.top + rect.height / 2 - tipRect.height / 2;
    } else { // right
      left = rect.right + 6;
      top = rect.top + rect.height / 2 - tipRect.height / 2;
    }
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (tip) { tip.remove(); tip = null; }
  }

  const enter = () => { timer = setTimeout(show, delay); };
  const leave = () => hide();
  trigger.addEventListener('mouseenter', enter);
  trigger.addEventListener('mouseleave', leave);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('blur', hide);

  return () => {
    hide();
    trigger.removeEventListener('mouseenter', enter);
    trigger.removeEventListener('mouseleave', leave);
    trigger.removeEventListener('focus', show);
    trigger.removeEventListener('blur', hide);
  };
}
