// Supabase encoder. Validated 2026-04-22 against AdaptiveShop full-stack run
// (see memory project_frank_calibration_sweep). The SDK accepts any non-empty
// shape-ish key at init; the JWT format below is what real Supabase keys use
// and keeps the SDK's parse path happy.

import type { EncoderEntry } from '../encoder-registry.js';

// JWT header/payload/signature construction. Encoded so the SDK can split on
// '.' and decode the header without failing. Payload is intentionally
// placeholder (iss: supabase, ref: placeholder, role anon|service_role).
const SUPABASE_ANON_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6OTk5OTk5OTk5OX0.' +
  '00000000000000000000000000000000000000000000';

const SUPABASE_SERVICE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjo5OTk5OTk5OTk5fQ.' +
  '00000000000000000000000000000000000000000000';

export const supabaseJsEncoder: EncoderEntry = {
  packageName: '@supabase/supabase-js',
  validatedVersions: '>=2.0.0',
  envKeys: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
  generate() {
    return {
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_JWT,
    };
  },
};

export const supabaseSsrEncoder: EncoderEntry = {
  packageName: '@supabase/ssr',
  validatedVersions: '>=0.4.0',
  envKeys: [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    // `@supabase/ssr` also reads the server-side vars if your middleware uses them.
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ],
  generate() {
    return {
      NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_JWT,
      SUPABASE_URL: 'https://placeholder.supabase.co',
      SUPABASE_ANON_KEY: SUPABASE_ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SUPABASE_SERVICE_JWT,
    };
  },
};
