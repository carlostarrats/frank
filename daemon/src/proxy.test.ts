import { describe, it, expect } from 'vitest';
import { validateProxyUrl } from './proxy.js';

describe('validateProxyUrl', () => {
  it('accepts http URLs', () => {
    expect(validateProxyUrl('http://example.com')).toEqual({ valid: true });
  });

  it('accepts https URLs', () => {
    expect(validateProxyUrl('https://example.com/page?q=1')).toEqual({ valid: true });
  });

  it('accepts localhost URLs', () => {
    expect(validateProxyUrl('http://localhost:3000')).toEqual({ valid: true });
  });

  it('rejects ftp URLs', () => {
    const result = validateProxyUrl('ftp://files.example.com');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Only HTTP and HTTPS URLs are allowed');
  });

  it('rejects file URLs', () => {
    const result = validateProxyUrl('file:///etc/passwd');
    expect(result.valid).toBe(false);
  });

  it('rejects javascript URLs', () => {
    const result = validateProxyUrl('javascript:alert(1)');
    expect(result.valid).toBe(false);
  });

  it('rejects invalid URLs', () => {
    const result = validateProxyUrl('not-a-url');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid URL');
  });

  it('rejects empty string', () => {
    const result = validateProxyUrl('');
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Invalid URL');
  });
});
