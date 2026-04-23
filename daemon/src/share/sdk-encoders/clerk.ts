// Clerk encoder. Validated 2026-04-22 against Clerk Next.js quickstart (see
// memory project_frank_clerk_stress_test).
//
// Clerk's publishable key is NOT opaque — it's `pk_<env>_<base64>` where the
// base64 decodes to `<frontend_api_host>$`. The SDK decodes at first use and
// throws "Publishable key not valid." on malformed input. This encoder emits
// a key whose decoded host is `placeholder.clerk.accounts.dev` — resolves via
// Clerk's wildcard DNS so the SDK's later HTTP calls fail at the endpoint
// layer, not in `initPublishableKeyValues`.

import type { EncoderEntry } from '../encoder-registry.js';

/** Produce a base64-without-padding string. */
function b64NoPadding(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64').replace(/=+$/, '');
}

export function generateClerkKeys(): { publishable: string; secret: string } {
  // Trailing '$' is Clerk's delimiter between host and suffix.
  const decoded = 'placeholder.clerk.accounts.dev$';
  const publishable = 'pk_test_' + b64NoPadding(decoded);
  // Secret keys are opaque from Frank's POV. The SDK checks prefix (pk_/sk_)
  // and env (test/live); the rest is just passed on the wire.
  const secret = 'sk_test_' + '0'.repeat(40);
  return { publishable, secret };
}

export const clerkNextEncoder: EncoderEntry = {
  packageName: '@clerk/nextjs',
  validatedVersions: '>=7.0.0 <9.0.0',
  envKeys: ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY'],
  generate() {
    const { publishable, secret } = generateClerkKeys();
    return {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
      CLERK_SECRET_KEY: secret,
    };
  },
};
