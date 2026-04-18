// ui/ — Frank's plain-JS component library, shadcn-styled via tokens.css + ui.css.
//
// Every primitive is a factory function that returns a DOM node (or a small
// object with a node + methods). No framework, no build step. Designed to be
// imported á la carte:
//
//   import { Button } from '../ui/index.js';
//   const btn = Button({ variant: 'primary', text: 'Save', onClick: ... });
//   container.appendChild(btn);

export { Button } from './button.js';
export { Input } from './input.js';
export { Textarea } from './textarea.js';
export { Label } from './label.js';
export { Card } from './card.js';
export { Badge } from './badge.js';
export { Separator } from './separator.js';
export { Dialog } from './dialog.js';
export { DropdownMenu } from './dropdown-menu.js';
export { Checkbox } from './checkbox.js';
export { Radio } from './radio.js';
export { Tabs } from './tabs.js';
export { Tooltip } from './tooltip.js';
