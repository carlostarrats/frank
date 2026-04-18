// paths.js — SVG path strings for Path-based flowchart shapes.
//
// Each constant is a path that fits inside a 100x100 unit box, positioned so
// the shape's bounding box runs from (0,0) to (100,100). shapes.js scales and
// translates from there. Keeping them unit-sized lets Konva.Path stretch
// cleanly when the user resizes via the Transformer.

export const CLOUD = [
  'M 20 70',
  'Q 0 70 0 55',
  'Q 0 40 15 35',
  'Q 15 15 35 15',
  'Q 50 0 65 15',
  'Q 90 10 95 30',
  'Q 100 55 80 60',
  'Q 75 75 55 70',
  'Q 40 85 20 70',
  'Z',
].join(' ');

export const SPEECH_BUBBLE = [
  'M 10 0',
  'L 90 0',
  'Q 100 0 100 10',
  'L 100 65',
  'Q 100 75 90 75',
  'L 30 75',
  'L 20 95',
  'L 20 75',
  'L 10 75',
  'Q 0 75 0 65',
  'L 0 10',
  'Q 0 0 10 0',
  'Z',
].join(' ');

export const DOCUMENT = [
  // Rectangle with a folded top-right corner.
  'M 0 0',
  'L 75 0',
  'L 100 25',
  'L 100 100',
  'L 0 100',
  'Z',
  'M 75 0',
  'L 75 25',
  'L 100 25',
].join(' ');

export const CYLINDER = [
  // Database cylinder: top ellipse, body, bottom ellipse.
  'M 0 15',
  'L 0 85',
  'Q 0 100 50 100',
  'Q 100 100 100 85',
  'L 100 15',
  'Q 100 0 50 0',
  'Q 0 0 0 15',
  'M 0 15',
  'Q 0 30 50 30',
  'Q 100 30 100 15',
].join(' ');

export const PARALLELOGRAM = [
  'M 20 0',
  'L 100 0',
  'L 80 100',
  'L 0 100',
  'Z',
].join(' ');
