// Manual harness for running pre-flight against a real project.
// Usage:
//   cd daemon
//   npx tsx scripts/check-preflight.ts <project-dir>
//
// Outputs: build verdict (pass/fail, duration, tail if fail), smoke verdict
// (readiness, routes probed, error count + samples).

import { checkEnvelope } from '../src/share/envelope.js';
import { runPreflight } from '../src/share/preflight.js';
import { readEnvShare } from '../src/share/env-share.js';
import { generateEncoderEnv } from '../src/share/encoder-registry.js';

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('Usage: tsx scripts/check-preflight.ts <project-dir>');
  process.exit(1);
}

// Envelope first — preflight is only meaningful if envelope passes
console.log('===== ENVELOPE =====');
const env = await checkEnvelope(projectDir);
console.log(`status: ${env.status}`);
if (env.status === 'fail') {
  console.log('failures:');
  for (const f of env.failures) {
    console.log(`  [${f.code}] ${f.message}`);
    if (f.hint) console.log(`    hint: ${f.hint}`);
  }
  process.exit(1);
}
console.log(`framework: ${env.framework!.id} ${env.framework!.versionSpec}`);

// Build share env: encoder outputs first (lowest priority), then .env.share
// user overrides, then Frank-injected FRANK_SHARE.
const encoderEnv = generateEncoderEnv(env.detectedSdks.map((s) => s.packageName));
const envShare = await readEnvShare(projectDir);
const mergedEnv: Record<string, string> = {
  ...encoderEnv,
  ...envShare,
  NEXT_PUBLIC_FRANK_SHARE: '1',
};

console.log('\n===== PRE-FLIGHT =====');
console.log(`encoder-generated env keys: ${Object.keys(encoderEnv).length}`);
console.log(`.env.share user-override keys: ${Object.keys(envShare).length}`);
const start = Date.now();
const result = await runPreflight({
  projectDir,
  framework: env.framework!.id,
  env: mergedEnv,
});
const total = Date.now() - start;

console.log(`\n--- BUILD ---`);
console.log(`status: ${result.build.status}`);
console.log(`duration: ${(result.build.durationMs / 1000).toFixed(1)}s`);
console.log(`exit code: ${result.build.exitCode}`);
if (result.build.status === 'fail') {
  console.log('stderr tail:');
  console.log(result.build.stderrTail);
}

if (result.smoke) {
  console.log(`\n--- SMOKE ---`);
  console.log(`readiness: ${result.smoke.readiness}`);
  console.log(`port: ${result.smoke.port}`);
  console.log(`startup: ${result.smoke.startupMs}ms`);
  console.log(`fallback routes used: ${result.smoke.usedFallbackRoutes}`);
  console.log(`routes probed:`);
  for (const r of result.smoke.routes) {
    console.log(`  ${r.pathname} → HTTP ${r.httpStatus ?? 'err'}${r.error ? ` (${r.error})` : ''}`);
  }
  console.log(`error lines in 30s tail: ${result.smoke.errorLineCount}`);
  if (result.smoke.errorSamples.length > 0) {
    console.log(`samples:`);
    for (const s of result.smoke.errorSamples) console.log(`  ${s}`);
  }
}

console.log(`\n===== OVERALL =====`);
console.log(`status: ${result.status}`);
console.log(`total: ${(total / 1000).toFixed(1)}s`);

process.exit(result.status === 'pass' ? 0 : 1);
