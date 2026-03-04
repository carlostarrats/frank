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
  schema: unknown; // Validated FrankSchema
}

export interface ClearMessage {
  type: 'clear'; // Session ended — panel clears all tabs
}

export type PanelMessage = RenderMessage | ClearMessage;

// ─── Paths ───────────────────────────────────────────────────────────────────

export const SOCKET_PATH = '/tmp/frank-daemon.sock';
export const WEBSOCKET_PORT = 42069;
export const SCHEMA_DIR = '/tmp/frank';
export const PENDING_EDIT_PATH = '/tmp/frank/pending-edit.json';

// Panel app locations — checked in order, first found wins
export const PANEL_APP_CANDIDATES = [
  '/Applications/frank.app',
  `${process.env.HOME}/Applications/frank.app`,
  // Dev build fallback
  `${process.env.HOME}/Documents/lookyloo/src-tauri/target/release/bundle/macos/frank.app`,
];


// Marker used in CLAUDE.md and settings.json to identify our injected blocks
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
export const SETTINGS_HOOK_MARKER = '__frank__';
