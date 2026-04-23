// Minimal dotenv-style parser for `.env.share`.
//
// The file is user-authored with dummy values covering SDKs that aren't in the
// encoder registry yet. We read it to answer "does the user supply values for
// every env key this SDK needs?" in the refuse-to-guess check (§1.4).
//
// Intentionally small: no variable substitution, no multi-line values, no
// export semantics. If a user needs complexity here, their share workflow is
// probably not ready for Frank yet — keep the contract narrow.

import * as fs from 'fs';
import * as path from 'path';

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of matching quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function readEnvShare(projectDir: string): Promise<Record<string, string>> {
  const filePath = path.join(projectDir, '.env.share');
  try {
    const contents = await fs.promises.readFile(filePath, 'utf-8');
    return parseEnvFile(contents);
  } catch {
    return {};
  }
}
