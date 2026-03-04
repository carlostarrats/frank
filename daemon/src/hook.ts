// Hook handler — called by Claude Code as a PostToolUse hook.
// Reads JSON from stdin, checks if it's a Frank schema write,
// sends the schema to the daemon via Unix socket, exits immediately.
//
// Must be fast: hooks run synchronously and block Claude Code's next action.
// Target: < 100ms total. No heavy processing here.

import net from 'net';
import { SOCKET_PATH, SCHEMA_DIR } from './protocol.js';

interface PostToolUsePayload {
  hook_event_name: string;
  tool_name: string;
  tool_input?: {
    file_path?: string;
    content?: string;
  };
}

export async function runHook(): Promise<void> {
  const raw = await readStdin();
  if (!raw.trim()) return;

  let payload: PostToolUsePayload;
  try {
    payload = JSON.parse(raw) as PostToolUsePayload;
  } catch {
    // Not JSON — not our concern
    return;
  }

  if (!isFrankWrite(payload)) return;

  const content = payload.tool_input?.content;
  if (!content) return;

  let schema: unknown;
  try {
    schema = JSON.parse(content);
  } catch {
    // Content isn't valid JSON — not a schema write
    return;
  }

  // Quick sanity check before sending to daemon
  if (!isLikelySchema(schema)) return;

  await sendToDaemon(schema);
}

function isFrankWrite(payload: PostToolUsePayload): boolean {
  if (payload.tool_name !== 'Write') return false;
  const path = payload.tool_input?.file_path ?? '';
  return path.startsWith(SCHEMA_DIR + '/') && path.endsWith('.json');
}

function isLikelySchema(val: unknown): boolean {
  if (typeof val !== 'object' || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    obj.schema === 'v1' &&
    (obj.type === 'screen' || obj.type === 'flow')
  );
}

async function sendToDaemon(schema: unknown): Promise<void> {
  return new Promise((resolve) => {
    const socket = net.createConnection(SOCKET_PATH);
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(); // Daemon not running — fail silently, don't block Claude Code
    }, 1500);

    socket.on('connect', () => {
      const message = JSON.stringify({ type: 'schema', payload: schema }) + '\n';
      socket.write(message, () => {
        clearTimeout(timeout);
        socket.end();
        resolve();
      });
    });

    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(); // Fail silently
    });
  });
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    // If stdin has no data (e.g. called directly), resolve after short delay
    setTimeout(() => resolve(data), 500);
  });
}
