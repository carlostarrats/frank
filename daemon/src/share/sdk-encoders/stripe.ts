// Stripe encoder. Validated 2026-04-22. The SDK is tolerant — the test-key
// prefix + a run of alphanumerics is enough to pass init. Real API calls
// (checkout.sessions.create, etc.) fail at HTTP level. Apps that retrieve
// checkout sessions during SSG prerender need the §5.4 guard.

import type { EncoderEntry } from '../encoder-registry.js';

function pkTest(len = 32): string { return 'pk_test_' + '0'.repeat(len); }
function skTest(len = 32): string { return 'sk_test_' + '0'.repeat(len); }
function whSec(len = 32): string { return 'whsec_' + '0'.repeat(len); }

export const stripeServerEncoder: EncoderEntry = {
  packageName: 'stripe',
  validatedVersions: '>=14.0.0',
  envKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  generate() {
    return {
      STRIPE_SECRET_KEY: skTest(),
      STRIPE_WEBHOOK_SECRET: whSec(),
    };
  },
};

export const stripeJsEncoder: EncoderEntry = {
  packageName: '@stripe/stripe-js',
  validatedVersions: '>=2.0.0',
  envKeys: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
  generate() {
    return {
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pkTest(),
    };
  },
};
