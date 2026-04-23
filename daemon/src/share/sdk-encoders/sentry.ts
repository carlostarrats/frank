// Sentry encoder. Validated 2026-04-22 — cleanest SDK in the sweep. The DSN
// shape `https://<public>@<host>/<id>` is all the SDK needs; events fail
// silently at the endpoint layer, not in `Sentry.init`. Using a real Sentry
// host so DNS resolves and we don't noise the 30s log tail.

import type { EncoderEntry } from '../encoder-registry.js';

const DUMMY_DSN = 'https://public@o0.ingest.sentry.io/0';

export const sentryNextEncoder: EncoderEntry = {
  packageName: '@sentry/nextjs',
  validatedVersions: '>=7.0.0',
  envKeys: ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN'],
  generate() {
    return {
      SENTRY_DSN: DUMMY_DSN,
      NEXT_PUBLIC_SENTRY_DSN: DUMMY_DSN,
    };
  },
};
