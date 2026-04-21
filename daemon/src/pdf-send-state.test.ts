import { describe, it, expect, beforeEach, vi } from 'vitest';
import { decidePdfSend, __resetForTests } from './pdf-send-state.js';

describe('decidePdfSend', () => {
  beforeEach(() => {
    __resetForTests();
    vi.useFakeTimers();
  });

  it('first push is state with full PDF + comments', () => {
    const decision = decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:application/pdf;base64,AAA');
    expect(decision.payload.mimeType).toBe('application/pdf');
    expect(decision.payload.comments).toHaveLength(1);
  });

  it('second push within 30s sends as diff with comments only', () => {
    decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [{ id: 'c1', text: 'hi' } as any],
    });
    vi.advanceTimersByTime(5_000);
    const decision = decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [{ id: 'c1', text: 'hi' } as any, { id: 'c2', text: 'yo' } as any],
    });
    expect(decision.kind).toBe('diff');
    expect((decision.payload as any).fileDataUrl).toBeUndefined();
    expect((decision.payload as any).mimeType).toBeUndefined();
    expect(decision.payload.comments).toHaveLength(2);
  });

  it('promotes to state after 30s idle even with no comment changes', () => {
    decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [],
    });
    vi.advanceTimersByTime(31_000);
    const decision = decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [],
    });
    expect(decision.kind).toBe('state');
    expect(decision.payload.fileDataUrl).toBe('data:application/pdf;base64,AAA');
  });

  it('separate shares have independent caches', () => {
    decidePdfSend('share1', {
      fileDataUrl: 'data:application/pdf;base64,AAA',
      mimeType: 'application/pdf',
      comments: [],
    });
    const decision = decidePdfSend('share2', {
      fileDataUrl: 'data:application/pdf;base64,BBB',
      mimeType: 'application/pdf',
      comments: [],
    });
    expect(decision.kind).toBe('state');
  });
});
