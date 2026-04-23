// Manual harness for running envelope + bundler against a real project.
// Usage:
//   cd daemon
//   npx tsx scripts/check-share.ts <project-dir>
//
// Outputs: envelope verdict, detected framework, detected SDKs, structural
// failures/warnings, bundler file count + rejected categories + total size.

import { checkEnvelope } from '../src/share/envelope.js';
import { buildBundle } from '../src/share/bundler.js';

const projectDir = process.argv[2];
if (!projectDir) {
  console.error('Usage: tsx scripts/check-share.ts <project-dir>');
  process.exit(1);
}

const env = await checkEnvelope(projectDir);
console.log('===== ENVELOPE =====');
console.log(`status: ${env.status}`);
console.log(`framework: ${env.framework ? `${env.framework.id} ${env.framework.versionSpec}` : '(none detected)'}`);
console.log(`detected SDKs (${env.detectedSdks.length}):`);
for (const sdk of env.detectedSdks) {
  console.log(
    `  - ${sdk.packageName}@${sdk.installedVersionSpec}  encoder=${sdk.hasEncoder}  envShareOverride=${sdk.hasEnvShareOverride}`,
  );
}
console.log(`failures (${env.failures.length}):`);
for (const f of env.failures) {
  console.log(`  [${f.code}] ${f.message}`);
  if (f.hint) console.log(`    hint: ${f.hint}`);
  if (f.detail) console.log(`    detail: ${JSON.stringify(f.detail)}`);
}
console.log(`warnings (${env.warnings.length}):`);
for (const w of env.warnings) {
  console.log(`  [${w.code}] ${w.message}`);
}

if (!env.framework) {
  console.log('\nNo framework — skipping bundler.');
  process.exit(env.status === 'pass' ? 0 : 1);
}

console.log('\n===== BUNDLER =====');
const bundle = await buildBundle(projectDir, { framework: env.framework.id });
console.log(`status: ${bundle.status}`);
console.log(`admitted files: ${bundle.files.length}`);
console.log(`total size: ${(bundle.totalSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`rejected: ${bundle.rejected.length}`);
const rejectionByReason: Record<string, number> = {};
for (const r of bundle.rejected) {
  rejectionByReason[r.reason] = (rejectionByReason[r.reason] ?? 0) + 1;
}
for (const [reason, count] of Object.entries(rejectionByReason)) {
  console.log(`  ${reason}: ${count}`);
}
// Show a sample of each rejection category for visibility
console.log('\nrejection samples (up to 5 per category):');
for (const reason of Object.keys(rejectionByReason)) {
  const samples = bundle.rejected.filter((r) => r.reason === reason).slice(0, 5);
  for (const s of samples) {
    console.log(`  [${reason}] ${s.relPath}${s.size ? ` (${s.size} bytes)` : ''}`);
  }
}

// Top 10 admitted files by size
console.log('\nlargest admitted files (top 10):');
for (const f of [...bundle.files].sort((a, b) => b.size - a.size).slice(0, 10)) {
  console.log(`  ${(f.size / 1024).toFixed(1).padStart(8)} KB  ${f.relPath}`);
}

process.exit(env.status === 'pass' && bundle.status === 'ok' ? 0 : 1);
