import { h } from './dom.js';

export function Checkbox({
  checked = false,
  onChange,
  disabled = false,
  id,
  name,
  ariaLabel,
  class: className,
  ref,
} = {}) {
  return h('input', {
    class: `ui-checkbox${className ? ' ' + className : ''}`,
    type: 'checkbox',
    checked,
    disabled,
    id,
    name,
    'aria-label': ariaLabel,
    onChange: (e) => onChange?.(e.target.checked, e),
    ref,
  });
}
