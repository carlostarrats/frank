import { describe, it, expect, vi } from 'vitest';
import { parseChatUrl } from './v0.js';
import { testToken, getChat, V0Error } from './v0.js';

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

describe('testToken', () => {
  it('returns true on 200', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await testToken('v0_good', fetchStub as any)).toBe(true);
    expect(fetchStub).toHaveBeenCalledWith(
      'https://api.v0.dev/v1/user',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer v0_good' }) }),
    );
  });
  it('returns false on 401', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    expect(await testToken('v0_bad', fetchStub as any)).toBe(false);
  });
  it('throws on network error', async () => {
    const fetchStub = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(testToken('v0_bad', fetchStub as any)).rejects.toBeInstanceOf(V0Error);
  });
});

describe('getChat', () => {
  it('returns name + webUrl on 200', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'abc', name: 'Header refactor', webUrl: 'https://v0.dev/chat/abc',
    }), { status: 200 }));
    const r = await getChat('v0_good', 'abc', fetchStub as any);
    expect(r).toEqual({ id: 'abc', name: 'Header refactor', webUrl: 'https://v0.dev/chat/abc' });
  });
  it('throws chat_not_found on 404', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(getChat('v0_good', 'abc', fetchStub as any)).rejects.toMatchObject({ code: 'chat_not_found' });
  });
  it('throws invalid_token on 401', async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(getChat('v0_bad', 'abc', fetchStub as any)).rejects.toMatchObject({ code: 'invalid_token' });
  });
});
