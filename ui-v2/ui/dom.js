// Small DOM helpers shared by primitives. Keep intentionally tiny — this file
// is the closest thing we have to a framework, and the point of plain JS is
// not to grow one.

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'ref' && typeof v === 'function') v(el);
    else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function mergeRef(el, ref) {
  if (typeof ref === 'function') ref(el);
}

let _id = 0;
export function uid(prefix = 'ui') { return `${prefix}-${(++_id).toString(36)}`; }

// Close-on-outside-click + Escape helper used by Dialog, DropdownMenu, Popover.
// Returns a teardown function that removes the listeners.
export function onDismiss(el, handler) {
  const onClick = (e) => { if (!el.contains(e.target)) handler('outside'); };
  const onKey = (e) => { if (e.key === 'Escape') handler('escape'); };
  // Defer attaching until after the event that opened the popover has bubbled.
  const timer = setTimeout(() => {
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
  }, 0);
  return () => {
    clearTimeout(timer);
    document.removeEventListener('mousedown', onClick);
    document.removeEventListener('keydown', onKey);
  };
}
