import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decideImageSend, __resetForTests } from './image-send-state.js';

describe('decideImageSend', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  it('first push is state with full image + comments', () => {
    const decision = decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:image/png;base64,AAA');
    expect(decision.payload.mimeType).toBe('image/png');
    expect(decision.payload.comments).toHaveLength(1);
  });

  it('second push within 30s sends as diff with comments only', () => {
    decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    vi.advanceTimersByTime(5_000);
    const decision = decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [{ id: 'c1', text: 'hi' } as any, { id: 'c2', text: 'yo' } as any],
    });
    expect(decision.kind).toBe('diff');
    expect((decision.payload as any).fileDataUrl).toBeUndefined();
    expect((decision.payload as any).mimeType).toBeUndefined();
    expect(decision.payload.comments).toHaveLength(2);
  });

  it('promotes to state after 30s idle even with no comment changes', () => {
    decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [],
    });
    vi.advanceTimersByTime(31_000);
    const decision = decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:image/png;base64,AAA');
  });

  it('separate shares have independent caches', () => {
    decideImageSend('share1', {
      fileDataUrl: 'data:image/png;base64,AAA',
      mimeType: 'image/png',
      comments: [],
    });
    const decision = decideImageSend('share2', {
      fileDataUrl: 'data:image/png;base64,BBB',
      mimeType: 'image/png',
      comments: [],
    });
    expect(decision.kind).toBe('state');
  });
});
