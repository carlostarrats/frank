// Daemon server — persistent process started by `frank start`.
//
// Two servers run simultaneously:
//   1. Unix domain socket at SOCKET_PATH — receives schemas from the hook handler
//   2. WebSocket server on WEBSOCKET_PORT — connected to by the Tauri panel
//
// When a schema arrives from the hook: validate minimally, broadcast to all panel connections.

import net from 'net';
import fs from 'fs';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import { SOCKET_PATH, WEBSOCKET_PORT, SCHEMA_DIR, type PanelMessage } from './protocol.js';

const panelClients = new Set<WebSocket>();
let lastSchema: unknown = null;

// ─── Default design tokens (shadcn/ui zinc palette) ───────────────────────────
// Auto-injected into every schema so downstream tools have exact values.
// Users can override per-schema by including a `tokens` block.

const DEFAULT_TOKENS = {
  colors: {
    background:              '#ffffff',
    foreground:              '#18181b',
    primary:                 '#18181b',
    'primary-foreground':    '#fafafa',
    secondary:               '#f4f4f5',
    'secondary-foreground':  '#18181b',
    muted:                   '#f4f4f5',
    'muted-foreground':      '#71717a',
    border:                  '#e4e4e7',
    input:                   '#e4e4e7',
    accent:                  '#3b82f6',
    'accent-foreground':     '#ffffff',
    destructive:             '#ef4444',
    card:                    '#ffffff',
    'card-foreground':       '#18181b',
  },
  typography: {
    headline:    { size: 28, weight: 700, lineHeight: 1.2, family: 'Inter, system-ui, sans-serif' },
    subheadline: { size: 16, weight: 400, lineHeight: 1.5, family: 'Inter, system-ui, sans-serif' },
    body:        { size: 14, weight: 400, lineHeight: 1.6, family: 'Inter, system-ui, sans-serif' },
    button:      { size: 14, weight: 600, lineHeight: 1,   family: 'Inter, system-ui, sans-serif' },
    label:       { size: 12, weight: 500, lineHeight: 1,   family: 'Inter, system-ui, sans-serif' },
    caption:     { size: 11, weight: 400, lineHeight: 1.4, family: 'Inter, system-ui, sans-serif' },
    'nav-label': { size: 10, weight: 500, lineHeight: 1,   family: 'Inter, system-ui, sans-serif' },
  },
  spacing: {
    base: 16,
    xs: 4, sm: 8, md: 16, lg: 24, xl: 40, '2xl': 64,
  },
  components: {
    'button-height':    40,
    'button-height-sm': 32,
    'button-height-lg': 48,
    'button-radius':    6,
    'button-padding-x': 16,
    'input-height':     40,
    'input-radius':     6,
    'input-padding-x':  12,
    'card-radius':      8,
    'card-shadow':      '0 1px 3px rgba(0,0,0,0.1)',
    'avatar-size':      36,
    'avatar-size-sm':   28,
    'badge-height':     22,
    'badge-radius':     4,
    'badge-padding-x':  8,
  },
};

export function startServer(): void {
  ensureSocketClean();
  startUnixSocketServer();
  startWebSocketServer();

  console.log(`[frank] daemon started`);
  console.log(`[frank] hook socket: ${SOCKET_PATH}`);
  console.log(`[frank] panel port:  ws://localhost:${WEBSOCKET_PORT}`);
}

// ─── Unix socket (receives from hook handler) ─────────────────────────────────

function startUnixSocketServer(): void {
  const server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep incomplete last line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        handleHookMessage(line.trim());
      }
    });

    socket.on('error', () => {}); // Ignore hook handler disconnects
  });

  server.listen(SOCKET_PATH, () => {
    console.log(`[frank] listening on ${SOCKET_PATH}`);
  });

  server.on('error', (err) => {
    console.error(`[frank] socket error:`, err.message);
  });
}

function handleHookMessage(raw: string): void {
  let msg: { type: string; payload?: unknown };
  try {
    msg = JSON.parse(raw) as { type: string; payload?: unknown };
  } catch {
    return;
  }

  if (msg.type !== 'schema' || !msg.payload) return;

  // Minimal validation — just check it looks like a schema
  const schema = msg.payload as Record<string, unknown>;
  if (schema.schema !== 'v1') return;
  if (schema.type !== 'screen' && schema.type !== 'flow') return;

  // Stamp with current time and default tokens (preserve any custom tokens Claude included)
  const stamped = {
    ...schema,
    timestamp: new Date().toISOString(),
    tokens: { ...DEFAULT_TOKENS, ...(schema.tokens as object | undefined) },
  };
  lastSchema = stamped;
  broadcast({ type: 'render', schema: stamped });
}

// ─── WebSocket server (sends to Tauri panel) ─────────────────────────────────

function startWebSocketServer(): void {
  const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

  wss.on('connection', (ws) => {
    panelClients.add(ws);
    console.log(`[frank] panel connected (${panelClients.size} total)`);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string; prompt?: string };
        if (msg.type === 'inject' && typeof msg.prompt === 'string') {
          applyEdit(msg.prompt);
        }
      } catch (e) {
        console.warn('[frank] message error:', e);
      }
    });

    ws.on('close', () => {
      panelClients.delete(ws);
      console.log(`[frank] panel disconnected (${panelClients.size} remaining)`);
    });

    ws.on('error', () => {
      panelClients.delete(ws);
    });
  });

  wss.on('error', (err) => {
    console.error(`[frank] websocket error:`, err.message);
  });
}

function broadcast(message: PanelMessage): void {
  const payload = JSON.stringify(message);
  for (const client of panelClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
  console.log(`[frank] broadcast ${message.type} to ${panelClients.size} panel(s)`);
}


// ─── Edit application via claude -p ──────────────────────────────────────────

function findClaude(): string | null {
  const candidates = [
    `${process.env.HOME}/.local/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const p of candidates) {
    try { execFileSync('test', ['-f', p]); return p; } catch { /* try next */ }
  }
  try { return execFileSync('which', ['claude'], { encoding: 'utf8' }).trim(); } catch { return null; }
}

const CLAUDE_BIN = findClaude();

function applyEdit(instruction: string): void {
  if (!CLAUDE_BIN) {
    console.warn('[frank] claude binary not found — cannot apply edit');
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = `${SCHEMA_DIR}/render-${ts}.json`;
  const schemaBlock = lastSchema
    ? `\nCurrent schema:\n${JSON.stringify(lastSchema, null, 2)}`
    : '';

  const prompt =
    `You are applying a Frank wireframe edit. Apply the change below to the schema ` +
    `and write the updated schema to ${outPath} using the Write tool. ` +
    `If the changed section type (e.g. header, bottom-nav, footer) appears on multiple screens, update it on ALL screens. ` +
    `Do not explain anything, just write the file.\n\n` +
    `Change: "${instruction}"` +
    schemaBlock;

  // Remove CLAUDECODE so nested-session guard doesn't block this headless invocation
  const env = { ...process.env };
  delete env['CLAUDECODE'];

  const child = spawn(CLAUDE_BIN, [
    '-p', prompt,
    '--permission-mode', 'bypassPermissions',
    '--allowedTools', 'Write',
  ], {
    env,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  console.log(`[frank] applying edit via claude: "${instruction.slice(0, 80)}"`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureSocketClean(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {
    // Socket didn't exist — that's fine
  }
}
