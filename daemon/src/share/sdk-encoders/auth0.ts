// Auth0 encoder. Validated 2026-04-22 (render-only, v4). Auth0Client
// constructor is lazy — no OIDC discovery at init; discovery fires on actual
// auth flow. Click-interaction probe pending.
//
// AUTH0_SECRET must be ≥ 64 bytes (Auth0 checks byte length). 72 zeros clears
// the bar.

import type { EncoderEntry } from '../encoder-registry.js';

export const auth0NextEncoder: EncoderEntry = {
  packageName: '@auth0/nextjs-auth0',
  validatedVersions: '>=4.0.0',
  envKeys: ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'AUTH0_SECRET'],
  generate() {
    return {
      AUTH0_DOMAIN: 'placeholder.us.auth0.com',
      AUTH0_CLIENT_ID: 'placeholder_client_id_0000000000000000',
      AUTH0_CLIENT_SECRET: 'placeholder_client_secret_00000000000000000000000000000000',
      AUTH0_SECRET: '0'.repeat(72),
    };
  },
};
