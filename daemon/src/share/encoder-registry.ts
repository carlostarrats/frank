// Encoder registry: per-SDK modules that emit valid-shape dummy env values.
//
// Populated at step 4 with validated encoders from the 2026-04-22 calibration
// sweep (see memory: project_frank_calibration_sweep).
//
// Rule of thumb: a registry entry means "Frank has opinions about this
// package's env vars at share time." Entries WITHOUT a `generate` function
// mean Frank knows the env keys the package needs but hasn't validated a
// dummy shape — those fall to the `.env.share` manual-value path per §1.4.

import { supabaseJsEncoder, supabaseSsrEncoder } from './sdk-encoders/supabase.js';
import { clerkNextEncoder } from './sdk-encoders/clerk.js';
import { stripeServerEncoder, stripeJsEncoder } from './sdk-encoders/stripe.js';
import { sentryNextEncoder } from './sdk-encoders/sentry.js';
import { auth0NextEncoder } from './sdk-encoders/auth0.js';
import { posthogJsEncoder } from './sdk-encoders/posthog.js';

export interface EncoderEntry {
  packageName: string;
  /** Semver range of installed versions Frank has validated against. */
  validatedVersions: string;
  /** Env keys the SDK requires in order to init without throwing. */
  envKeys: string[];
  /**
   * Emit dummy values that pass the SDK's init validator. Entries WITHOUT
   * `generate` are known-packages with no validated encoder yet; those force
   * the user to supply values via `.env.share` per §1.4.
   */
  generate?(): Record<string, string>;
}

const ENTRIES: EncoderEntry[] = [
  supabaseJsEncoder,
  supabaseSsrEncoder,
  clerkNextEncoder,
  stripeServerEncoder,
  stripeJsEncoder,
  sentryNextEncoder,
  auth0NextEncoder,
  posthogJsEncoder,
];

export const registry: Record<string, EncoderEntry> = Object.fromEntries(
  ENTRIES.map((e) => [e.packageName, e]),
);

export function lookupEncoder(packageName: string): EncoderEntry | undefined {
  return registry[packageName];
}

export function knownPackageNames(): string[] {
  return Object.keys(registry);
}

/**
 * Generate dummy env for every detected SDK in the given package set that has
 * an encoder. Caller is responsible for merging over the result with any
 * `.env.share` user overrides (§3.3 — user values win over encoder output).
 */
export function generateEncoderEnv(packageNames: readonly string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of packageNames) {
    const entry = registry[name];
    if (!entry?.generate) continue;
    Object.assign(env, entry.generate());
  }
  return env;
}
