import { h } from './dom.js';

// Button({ variant, size, text, icon, onClick, disabled, type, ref })
// variant: 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive'  (default 'secondary')
// size:    'sm' | 'md' | 'lg' | 'icon'                                    (default 'md')
export function Button({
  variant = 'secondary',
  size = 'md',
  text,
  icon,
  children,
  onClick,
  disabled = false,
  type = 'button',
  title,
  ariaLabel,
  class: className,
  ref,
} = {}) {
  const kids = [];
  if (icon) kids.push(icon instanceof Node ? icon : h('span', { class: 'ui-button-icon' }, icon));
  if (text) kids.push(h('span', { class: 'ui-button-text' }, text));
  if (children) kids.push(...(Array.isArray(children) ? children : [children]));

  return h('button', {
    class: `ui-button${className ? ' ' + className : ''}`,
    type,
    dataset: { variant, size },
    title,
    'aria-label': ariaLabel,
    disabled,
    onClick,
    ref,
  }, kids);
}
