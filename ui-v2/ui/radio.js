import { h } from './dom.js';

export function Radio({
  checked = false,
  value,
  onChange,
  disabled = false,
  name,
  id,
  ariaLabel,
  class: className,
  ref,
} = {}) {
  return h('input', {
    class: `ui-radio${className ? ' ' + className : ''}`,
    type: 'radio',
    checked,
    value,
    disabled,
    name,
    id,
    'aria-label': ariaLabel,
    onChange: (e) => onChange?.(e.target.value, e),
    ref,
  });
}
