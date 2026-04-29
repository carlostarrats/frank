import { describe, it, expect } from 'vitest';
import { parseChatUrl } from './v0.js';

describe('parseChatUrl', () => {
  it('extracts chat ID from v0.dev URL', () => {
    expect(parseChatUrl('https://v0.dev/chat/abc123XyZ')).toBe('abc123XyZ');
  });
  it('extracts chat ID from v0.app URL', () => {
    expect(parseChatUrl('https://v0.app/chat/abc123XyZ')).toBe('abc123XyZ');
  });
  it('handles trailing path segments (revisions)', () => {
    expect(parseChatUrl('https://v0.dev/chat/abc123/r/v2')).toBe('abc123');
  });
  it('handles trailing slash and query string', () => {
    expect(parseChatUrl('https://v0.dev/chat/abc123/?ref=share')).toBe('abc123');
  });
  it('returns null for non-chat URLs', () => {
    expect(parseChatUrl('https://v0.dev/')).toBeNull();
    expect(parseChatUrl('https://example.com/chat/abc')).toBeNull();
    expect(parseChatUrl('not a url')).toBeNull();
  });
  it('accepts a bare chat ID (user pasted just the ID, no URL)', () => {
    expect(parseChatUrl('abc123XyZ')).toBe('abc123XyZ');
  });
});
