// Shared types and constants for daemon ↔ browser communication.

// ─── Project types ──────────────────────────────────────────────────────────

export interface ProjectV2 {
  frank_version: '2';
  name: string;
  contentType: 'url' | 'pdf' | 'image' | 'canvas';
  url?: string;           // For contentType: 'url'
  file?: string;          // For contentType: 'pdf' | 'image'
  screens: Record<string, ScreenV2>;
  screenOrder: string[];
  capture: boolean;
  activeShare: ActiveShare | null;
  created: string;
  modified: string;
  // v2: canvas-backed projects opt in here. Absent on v1 projects.
  canvasEnabled?: boolean;
}

export interface ScreenV2 {
  route: string;
  label: string;
}

export interface ActiveShare {
  id: string;
  revokeToken: string;
  createdAt: string;
  expiresAt: string;
  coverNote: string;
  lastSyncedNoteId: string | null;
  unseenNotes: number;
}

export interface CommentAnchor {
  type: 'element' | 'pin';
  cssSelector?: string;    // Primary anchor for element type
  domPath?: string;        // Fallback for element type
  x: number;               // Visual coordinates (% of viewport)
  y: number;
  pageNumber?: number;     // For PDFs
}

export interface Comment {
  id: string;
  screenId: string;
  anchor: CommentAnchor;
  author: string;
  text: string;
  ts: string;
  status: 'pending' | 'approved' | 'dismissed' | 'remixed';
}

// ─── App → Daemon (WebSocket) ───────────────────────────────────────────────

export interface ListProjectsRequest { type: 'list-projects'; requestId?: number; }
export interface LoadProjectRequest { type: 'load-project'; projectId: string; requestId?: number; }
export interface CreateProjectRequest { type: 'create-project'; name: string; contentType: 'url' | 'pdf' | 'image' | 'canvas'; url?: string; file?: string; requestId?: number; }
export interface LoadCanvasStateRequest { type: 'load-canvas-state'; requestId?: number; }
export interface SaveCanvasStateRequest { type: 'save-canvas-state'; state: string; requestId?: number; }
export interface DeleteProjectRequest { type: 'delete-project'; projectId: string; requestId?: number; }
export interface AddScreenRequest { type: 'add-screen'; route: string; label: string; requestId?: number; }
export interface AddCommentRequest { type: 'add-comment'; screenId: string; anchor: CommentAnchor; text: string; requestId?: number; }
export interface DeleteCommentRequest { type: 'delete-comment'; commentId: string; requestId?: number; }
export interface ProxyUrlRequest { type: 'proxy-url'; url: string; requestId?: number; }
export interface UploadShareRequest { type: 'upload-share'; snapshot: unknown; coverNote: string; contentType: string; oldShareId?: string; oldRevokeToken?: string; requestId?: number; }
export interface CloudStatusRequest { type: 'cloud-status'; requestId?: number; }
export interface SaveSnapshotRequest { type: 'save-snapshot'; html: string; screenshot: string | null; trigger: 'manual' | 'share' | 'ai-applied'; triggeredBy?: string; requestId?: number; }
export interface ListSnapshotsRequest { type: 'list-snapshots'; requestId?: number; }
export interface StarSnapshotRequest { type: 'star-snapshot'; snapshotId: string; label: string; requestId?: number; }
export interface CurateCommentRequest { type: 'curate-comment'; commentIds: string[]; action: 'approve' | 'dismiss' | 'remix' | 'batch'; remixedText?: string; dismissReason?: string; requestId?: number; }
export interface LogAiInstructionRequest { type: 'log-ai-instruction'; feedbackIds: string[]; curationIds: string[]; instruction: string; requestId?: number; }
export interface ExportProjectRequest { type: 'export-project'; requestId?: number; }

export type AppMessage =
  | ListProjectsRequest
  | LoadProjectRequest
  | CreateProjectRequest
  | DeleteProjectRequest
  | AddScreenRequest
  | AddCommentRequest
  | DeleteCommentRequest
  | ProxyUrlRequest
  | UploadShareRequest
  | CloudStatusRequest
  | SaveSnapshotRequest
  | ListSnapshotsRequest
  | StarSnapshotRequest
  | CurateCommentRequest
  | LogAiInstructionRequest
  | ExportProjectRequest
  | LoadCanvasStateRequest
  | SaveCanvasStateRequest;

// ─── Daemon → App (WebSocket) ───────────────────────────────────────────────

export interface ProjectListMessage {
  type: 'project-list';
  requestId?: number;
  projects: Array<{ name: string; projectId: string; contentType: string; modified: string; commentCount: number }>;
}

export interface ProjectLoadedMessage {
  type: 'project-loaded';
  requestId?: number;
  projectId?: string;
  project: ProjectV2;
  comments: Comment[];
}

export interface CommentAddedMessage {
  type: 'comment-added';
  comment: Comment;
}

export interface ProxyReadyMessage {
  type: 'proxy-ready';
  requestId?: number;
  proxyUrl: string;
}

export interface ErrorMessage {
  type: 'error';
  requestId?: number;
  error: string;
}

export interface ShareUploadedMessage {
  type: 'share-uploaded';
  requestId?: number;
  shareId: string;
  revokeToken: string;
  url: string;
}

export interface CloudStatusMessage {
  type: 'cloud-status';
  requestId?: number;
  connected: boolean;
  cloudUrl: string | null;
}

export interface SnapshotSavedMessage { type: 'snapshot-saved'; requestId?: number; snapshot: unknown; }
export interface SnapshotListMessage { type: 'snapshot-list'; requestId?: number; snapshots: unknown[]; }
export interface CurationDoneMessage { type: 'curation-done'; requestId?: number; curation: unknown; }
export interface AiInstructionLoggedMessage { type: 'ai-instruction-logged'; requestId?: number; instruction: unknown; }
export interface ExportReadyMessage { type: 'export-ready'; requestId?: number; data: unknown; }
export interface CanvasStateLoadedMessage { type: 'canvas-state-loaded'; requestId?: number; state: string | null; }
export interface CanvasStateSavedMessage { type: 'canvas-state-saved'; requestId?: number; }

export type DaemonMessage =
  | ProjectListMessage
  | ProjectLoadedMessage
  | CommentAddedMessage
  | ProxyReadyMessage
  | ErrorMessage
  | ShareUploadedMessage
  | CloudStatusMessage
  | SnapshotSavedMessage
  | SnapshotListMessage
  | CurationDoneMessage
  | AiInstructionLoggedMessage
  | ExportReadyMessage
  | CanvasStateLoadedMessage
  | CanvasStateSavedMessage;

// ─── Paths ──────────────────────────────────────────────────────────────────

export const FRANK_DIR = `${process.env.HOME}/.frank`;
export const PROJECTS_DIR = `${process.env.HOME}/.frank/projects`;
export const CONFIG_PATH = `${process.env.HOME}/.frank/config.json`;

export const WEBSOCKET_PORT = 42069;
export const HTTP_PORT = 42068;

// Marker used in CLAUDE.md to identify our injected block
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
