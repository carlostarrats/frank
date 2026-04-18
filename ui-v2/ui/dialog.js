import { h, onDismiss } from './dom.js';

// Dialog({ title, description, body, footer, onClose })
// Returns { node, close }. Append `node` to document.body to show; call
// close() to tear down (also happens on backdrop click or Escape unless
// dismissable: false).
export function Dialog({
  title,
  description,
  body,
  footer,
  onClose,
  dismissable = true,
  class: className,
} = {}) {
  const dialog = h('div', {
    class: `ui-dialog${className ? ' ' + className : ''}`,
    role: 'dialog',
    'aria-modal': 'true',
  });

  const closeBtn = h('button', {
    class: 'ui-dialog-close',
    type: 'button',
    'aria-label': 'Close',
    onClick: () => close(),
  }, ['×']);

  const headerChildren = [];
  if (title) headerChildren.push(h('div', { class: 'ui-dialog-title' }, title));
  if (dismissable) headerChildren.push(closeBtn);
  if (headerChildren.length) dialog.appendChild(h('div', { class: 'ui-dialog-header' }, headerChildren));

  if (description) dialog.appendChild(h('div', { class: 'ui-dialog-description' }, description));

  const bodyNode = body instanceof Node ? body : (body != null ? document.createTextNode(body) : null);
  if (bodyNode) {
    const bodyWrap = h('div', { class: 'ui-dialog-body' });
    bodyWrap.appendChild(bodyNode);
    dialog.appendChild(bodyWrap);
  }

  if (footer) {
    const footerNode = footer instanceof Node ? footer : document.createTextNode(footer);
    const footerWrap = h('div', { class: 'ui-dialog-footer' });
    footerWrap.appendChild(footerNode);
    dialog.appendChild(footerWrap);
  }

  const overlay = h('div', { class: 'ui-dialog-overlay' }, [dialog]);
  let removeDismiss = () => {};
  if (dismissable) {
    removeDismiss = onDismiss(dialog, () => close());
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    removeDismiss();
    overlay.remove();
    if (onClose) onClose();
  }

  return { node: overlay, close };
}
