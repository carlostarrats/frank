import { describe, it, expect } from 'vitest';
import {
  registry,
  lookupEncoder,
  knownPackageNames,
  generateEncoderEnv,
} from './encoder-registry.js';
import { generateClerkKeys } from './sdk-encoders/clerk.js';

describe('registry', () => {
  it('includes all v1 launch-supported SDKs', () => {
    const expected = [
      '@supabase/supabase-js',
      '@supabase/ssr',
      '@clerk/nextjs',
      'stripe',
      '@stripe/stripe-js',
      '@sentry/nextjs',
      '@auth0/nextjs-auth0',
      'posthog-js',
    ];
    for (const name of expected) {
      expect(registry[name]).toBeDefined();
      expect(registry[name].generate).toBeDefined();
    }
  });

  it('lookupEncoder returns undefined for unknown packages', () => {
    expect(lookupEncoder('@weirdco/not-in-registry')).toBeUndefined();
  });

  it('knownPackageNames contains all validated entries', () => {
    const names = knownPackageNames();
    expect(names).toContain('@supabase/supabase-js');
    expect(names).toContain('@clerk/nextjs');
  });
});

describe('generateEncoderEnv', () => {
  it('returns empty object for empty input', () => {
    expect(generateEncoderEnv([])).toEqual({});
  });

  it('skips unknown packages', () => {
    expect(generateEncoderEnv(['@weirdco/nothing'])).toEqual({});
  });

  it('merges multiple encoder outputs', () => {
    const env = generateEncoderEnv(['@supabase/supabase-js', '@clerk/nextjs']);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://placeholder.supabase.co');
    expect(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY).toMatch(/^pk_test_/);
  });

  it('later encoders can override earlier ones (Object.assign semantics)', () => {
    // Both supabase-js and supabase/ssr set NEXT_PUBLIC_SUPABASE_URL.
    // The order matters — ssr comes after js in the registry, and both
    // should produce the same value so override is a non-issue in practice.
    const env = generateEncoderEnv(['@supabase/supabase-js', '@supabase/ssr']);
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe('https://placeholder.supabase.co');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
  });
});

describe('supabase encoder output', () => {
  it('produces JWT-shaped anon key', () => {
    const out = registry['@supabase/supabase-js'].generate!();
    const key = out.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // JWT has three base64 parts separated by dots
    const parts = key.split('.');
    expect(parts).toHaveLength(3);
    // First part should decode to a JSON header with alg/typ
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('ssr encoder produces both public and server-side keys', () => {
    const out = registry['@supabase/ssr'].generate!();
    expect(out.NEXT_PUBLIC_SUPABASE_URL).toBeDefined();
    expect(out.SUPABASE_URL).toBeDefined();
    expect(out.SUPABASE_SERVICE_ROLE_KEY).toBeDefined();
  });
});

describe('clerk encoder output', () => {
  it('publishable key has pk_test_ prefix and decodable base64 host', () => {
    const { publishable } = generateClerkKeys();
    expect(publishable.startsWith('pk_test_')).toBe(true);
    const encoded = publishable.slice('pk_test_'.length);
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    expect(decoded).toBe('placeholder.clerk.accounts.dev$');
  });

  it('secret key has sk_test_ prefix', () => {
    const { secret } = generateClerkKeys();
    expect(secret.startsWith('sk_test_')).toBe(true);
  });
});

describe('auth0 encoder output', () => {
  it('AUTH0_SECRET is at least 64 bytes', () => {
    const out = registry['@auth0/nextjs-auth0'].generate!();
    expect(out.AUTH0_SECRET.length).toBeGreaterThanOrEqual(64);
  });
});

describe('stripe encoder output', () => {
  it('uses pk_test_ / sk_test_ / whsec_ prefixes', () => {
    const server = registry.stripe.generate!();
    expect(server.STRIPE_SECRET_KEY.startsWith('sk_test_')).toBe(true);
    expect(server.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')).toBe(true);
    const client = registry['@stripe/stripe-js'].generate!();
    expect(client.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_')).toBe(true);
  });
});

describe('sentry encoder output', () => {
  it('DSN is in valid https://<pub>@<host>/<id> form', () => {
    const out = registry['@sentry/nextjs'].generate!();
    expect(out.SENTRY_DSN).toMatch(/^https:\/\/[^@]+@[^/]+\/\d+$/);
    expect(out.NEXT_PUBLIC_SENTRY_DSN).toMatch(/^https:\/\/[^@]+@[^/]+\/\d+$/);
  });
});

describe('posthog encoder output', () => {
  it('key has phc_ prefix; host is real PostHog', () => {
    const out = registry['posthog-js'].generate!();
    expect(out.NEXT_PUBLIC_POSTHOG_KEY.startsWith('phc_')).toBe(true);
    expect(out.NEXT_PUBLIC_POSTHOG_HOST).toBe('https://us.i.posthog.com');
  });
});
