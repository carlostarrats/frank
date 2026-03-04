// WebSocket message types from daemon → panel.
// Mirrors protocol.ts in the daemon package — kept in sync manually.

export interface RenderMessage {
  type: 'render';
  schema: unknown; // Validated by the React schema validator before use
}

export interface ClearMessage {
  type: 'clear';
}

export type PanelMessage = RenderMessage | ClearMessage;
