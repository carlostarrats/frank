import { h } from './dom.js';

// Input({ type, value, placeholder, onInput, onChange, onKeyDown, disabled, id, ref })
export function Input({
  type = 'text',
  value = '',
  placeholder,
  onInput,
  onChange,
  onKeyDown,
  disabled = false,
  id,
  name,
  autocomplete,
  autofocus,
  class: className,
  ref,
} = {}) {
  return h('input', {
    class: `ui-input${className ? ' ' + className : ''}`,
    type,
    value,
    placeholder,
    id,
    name,
    autocomplete,
    autofocus,
    disabled,
    onInput,
    onChange,
    onKeydown: onKeyDown,
    ref,
  });
}
