// Shared message types for daemon ↔ panel communication.
// Hook handler → daemon: via Unix domain socket
// Daemon → panel: via WebSocket

// ─── Hook handler → daemon (Unix socket) ────────────────────────────────────

export interface SchemaMessage {
  type: 'schema';
  payload: unknown; // Raw JSON from Claude — daemon validates before forwarding
}

export type HookMessage = SchemaMessage;

// ─── Daemon → panel (WebSocket) ───────────────────────────────────────────────

export interface RenderMessage {
  type: 'render';
  schema: unknown; // Validated LookyLooSchema
}

export interface ClearMessage {
  type: 'clear'; // Session ended — panel clears all tabs
}

export type PanelMessage = RenderMessage | ClearMessage;

// ─── Paths ───────────────────────────────────────────────────────────────────

export const SOCKET_PATH = '/tmp/lookyloo-daemon.sock';
export const WEBSOCKET_PORT = 42069;
export const SCHEMA_DIR = '/tmp/lookyloo';

// Marker used in CLAUDE.md and settings.json to identify our injected blocks
export const INJECT_MARKER_START = '<!-- LOOKYLOO:START -->';
export const INJECT_MARKER_END = '<!-- LOOKYLOO:END -->';
export const SETTINGS_HOOK_MARKER = '__lookyloo__';
