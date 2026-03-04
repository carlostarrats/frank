// Shared types and constants for daemon ↔ panel communication.

// ─── Daemon → panel (WebSocket) ───────────────────────────────────────────────

export interface RenderMessage {
  type: 'render';
  schema: unknown;
}

export interface ClearMessage {
  type: 'clear';
}

export type PanelMessage = RenderMessage | ClearMessage;

// ─── Paths ───────────────────────────────────────────────────────────────────

export const WEBSOCKET_PORT = 42069;
export const SCHEMA_DIR = '/tmp/frank';

// Panel app locations — checked in order, first found wins
export const PANEL_APP_CANDIDATES = [
  '/Applications/frank.app',
  `${process.env.HOME}/Applications/frank.app`,
  `${process.env.HOME}/Documents/lookyloo/src-tauri/target/release/bundle/macos/frank.app`,
];

// Marker used in CLAUDE.md to identify our injected block
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
