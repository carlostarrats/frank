// PostHog encoder. Validated 2026-04-22 — tolerant SDK, opaque key, events
// queue + fail silently. api_host points at real PostHog so DNS resolves.

import type { EncoderEntry } from '../encoder-registry.js';

export const posthogJsEncoder: EncoderEntry = {
  packageName: 'posthog-js',
  validatedVersions: '>=1.0.0',
  envKeys: ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST'],
  generate() {
    return {
      NEXT_PUBLIC_POSTHOG_KEY: 'phc_' + '0'.repeat(40),
      NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com',
    };
  },
};
