import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decideCanvasSend, __resetForTests } from './canvas-send-state.js';

describe('decideCanvasSend', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  it('first push is always state with all assets', () => {
    const decision = decideCanvasSend('share1', {
      canvasState: '{"k":1}',
      assets: { 'url-a': 'data:image/png;base64,AAA', 'url-b': 'data:image/png;base64,BBB' },
    });
    expect(decision.kind).toBe('state');
    expect(Object.keys(decision.payload.assets)).toEqual(['url-a', 'url-b']);
  });

  it('second push with same assets sends as diff with empty assets', () => {
    decideCanvasSend('share1', {
      canvasState: '{"k":1}',
      assets: { 'url-a': 'data:image/png;base64,AAA' },
    });
    const decision = decideCanvasSend('share1', {
      canvasState: '{"k":2}',
      assets: { 'url-a': 'data:image/png;base64,AAA' },
    });
    expect(decision.kind).toBe('diff');
    expect(decision.payload.assets).toEqual({});
    expect(decision.payload.canvasState).toBe('{"k":2}');
  });

  it('new asset triggers a state push carrying full asset bundle', () => {
    decideCanvasSend('share1', {
      canvasState: '{"k":1}',
      assets: { 'url-a': 'data:image/png;base64,AAA' },
    });
    const decision = decideCanvasSend('share1', {
      canvasState: '{"k":2}',
      assets: { 'url-a': 'data:image/png;base64,AAA', 'url-b': 'data:image/png;base64,BBB' },
    });
    expect(decision.kind).toBe('state');
    expect(Object.keys(decision.payload.assets).sort()).toEqual(['url-a', 'url-b']);
  });

  it('promotes to state after 30s idle even with no asset changes', () => {
    decideCanvasSend('share1', { canvasState: '{"k":1}', assets: { 'a': 'x' } });
    const d1 = decideCanvasSend('share1', { canvasState: '{"k":2}', assets: { 'a': 'x' } });
    expect(d1.kind).toBe('diff');
    vi.advanceTimersByTime(31_000);
    const d2 = decideCanvasSend('share1', { canvasState: '{"k":3}', assets: { 'a': 'x' } });
    expect(d2.kind).toBe('state');
  });

  it('separate shares have independent caches', () => {
    decideCanvasSend('share1', { canvasState: '{"k":1}', assets: { 'a': 'x' } });
    const decision = decideCanvasSend('share2', { canvasState: '{"k":1}', assets: { 'a': 'x' } });
    expect(decision.kind).toBe('state'); // first push for share2
  });
});
