import { h } from './dom.js';

export function Textarea({
  value = '',
  placeholder,
  rows = 3,
  onInput,
  onChange,
  onKeyDown,
  disabled = false,
  id,
  name,
  class: className,
  ref,
} = {}) {
  return h('textarea', {
    class: `ui-textarea${className ? ' ' + className : ''}`,
    placeholder,
    rows,
    id,
    name,
    disabled,
    onInput,
    onChange,
    onKeydown: onKeyDown,
    ref,
  }, [value]);
}
