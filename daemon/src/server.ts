// Daemon server — persistent process started by `lookyloo start`.
//
// Two servers run simultaneously:
//   1. Unix domain socket at SOCKET_PATH — receives schemas from the hook handler
//   2. WebSocket server on WEBSOCKET_PORT — connected to by the Tauri panel
//
// When a schema arrives from the hook: validate minimally, broadcast to all panel connections.

import net from 'net';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { SOCKET_PATH, WEBSOCKET_PORT, type PanelMessage } from './protocol.js';

const panelClients = new Set<WebSocket>();

export function startServer(): void {
  ensureSocketClean();
  startUnixSocketServer();
  startWebSocketServer();

  console.log(`[lookyloo] daemon started`);
  console.log(`[lookyloo] hook socket: ${SOCKET_PATH}`);
  console.log(`[lookyloo] panel port:  ws://localhost:${WEBSOCKET_PORT}`);
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
    console.log(`[lookyloo] listening on ${SOCKET_PATH}`);
  });

  server.on('error', (err) => {
    console.error(`[lookyloo] socket error:`, err.message);
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

  broadcast({ type: 'render', schema: msg.payload });
}

// ─── WebSocket server (sends to Tauri panel) ─────────────────────────────────

function startWebSocketServer(): void {
  const wss = new WebSocketServer({ port: WEBSOCKET_PORT });

  wss.on('connection', (ws) => {
    panelClients.add(ws);
    console.log(`[lookyloo] panel connected (${panelClients.size} total)`);

    ws.on('close', () => {
      panelClients.delete(ws);
      console.log(`[lookyloo] panel disconnected (${panelClients.size} remaining)`);
    });

    ws.on('error', () => {
      panelClients.delete(ws);
    });
  });

  wss.on('error', (err) => {
    console.error(`[lookyloo] websocket error:`, err.message);
  });
}

function broadcast(message: PanelMessage): void {
  const payload = JSON.stringify(message);
  for (const client of panelClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
  console.log(`[lookyloo] broadcast ${message.type} to ${panelClients.size} panel(s)`);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureSocketClean(): void {
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {
    // Socket didn't exist — that's fine
  }
}
