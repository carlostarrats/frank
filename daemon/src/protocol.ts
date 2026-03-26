// Shared types and constants for daemon ↔ panel communication.

// ─── Daemon → panel (WebSocket) ───────────────────────────────────────────────

export interface RenderMessage {
  type: 'render';
  schema: unknown;
}

export interface ClearMessage {
  type: 'clear';
}

// ─── App → Daemon (WebSocket) ─────────────────────────────────────────────

export interface ListProjectsRequest { type: 'list-projects'; requestId?: number; }
export interface LoadProjectRequest { type: 'load-project'; filePath: string; requestId?: number; }
export interface SaveProjectRequest { type: 'save-project'; project: unknown; requestId?: number; }
export interface CreateProjectRequest { type: 'create-project'; label: string; requestId?: number; }
export interface ArchiveProjectRequest { type: 'archive-project'; filePath: string; requestId?: number; }
export interface ProjectChangedMessage { type: 'project-changed'; filePath: string; }

export type AppMessage =
  | ListProjectsRequest
  | LoadProjectRequest
  | SaveProjectRequest
  | CreateProjectRequest
  | ArchiveProjectRequest
  | ProjectChangedMessage
  | { type: 'inject'; prompt: string };

// ─── Daemon → App (WebSocket) ─────────────────────────────────────────────

export interface ProjectUpdatedMessage {
  type: 'project-updated';
  project: unknown;
  filePath: string;
}

export interface NotesUpdatedMessage {
  type: 'notes-updated';
  screenId: string;
  notes: Array<{ id: string; author: string; screenId: string; section: number | null; text: string; ts: string }>;
}

export type PanelMessage = RenderMessage | ClearMessage | ProjectUpdatedMessage | NotesUpdatedMessage;

// ─── Paths ───────────────────────────────────────────────────────────────────

export const PROJECTS_DIR = `${process.env.HOME}/Documents/Frank`;
export const ARCHIVE_DIR = `${process.env.HOME}/Documents/Frank/.archive`;

export const WEBSOCKET_PORT = 42069;
export const HTTP_PORT = 42068;
export const SCHEMA_DIR = '/tmp/frank';

// Marker used in CLAUDE.md to identify our injected block
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
