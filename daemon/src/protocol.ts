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
  // v2.02: lifecycle flags. Absence = active.
  archived?: string;  // ISO timestamp when archived
  trashed?: string;   // ISO timestamp when soft-deleted; auto-purged at 30d
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
  type: 'element' | 'pin' | 'shape';
  cssSelector?: string;    // Primary anchor for element type
  domPath?: string;        // Fallback for element type
  x: number;               // Visual coords (% of viewport for element/pin; world coords for shape)
  y: number;
  pageNumber?: number;     // For PDFs
  shapeId?: string;        // Target shape for canvas anchors
  // Last-known world position. Pin stays here if the shape is deleted so the
  // comment survives the edit. Updated whenever the shape is repositioned.
  shapeLastKnown?: { x: number; y: number };
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
export interface GetAiConfigRequest { type: 'get-ai-config'; requestId?: number; }
export interface SetAiApiKeyRequest { type: 'set-ai-api-key'; provider: 'claude'; apiKey: string; requestId?: number; }
export interface ClearAiApiKeyRequest { type: 'clear-ai-api-key'; provider: 'claude'; requestId?: number; }
export interface ListAiConversationsRequest { type: 'list-ai-conversations'; requestId?: number; }
export interface LoadAiConversationRequest { type: 'load-ai-conversation'; conversationId: string; requestId?: number; }
export interface SendAiMessageRequest {
  type: 'send-ai-message';
  conversationId?: string;      // omit to start a new conversation
  continuedFrom?: string;       // optional prior conversation id for continuity linking
  message: string;              // user's typed input
  feedbackIds?: string[];       // curated comment ids to attach
  requestId?: number;
}
export interface DeleteProjectRequest { type: 'delete-project'; projectId: string; requestId?: number; }
export interface RenameProjectRequest { type: 'rename-project'; projectId: string; name: string; requestId?: number; }
export interface ArchiveProjectRequest { type: 'archive-project'; projectId: string; requestId?: number; }
export interface UnarchiveProjectRequest { type: 'unarchive-project'; projectId: string; requestId?: number; }
export interface TrashProjectRequest { type: 'trash-project'; projectId: string; requestId?: number; }
export interface RestoreProjectRequest { type: 'restore-project'; projectId: string; requestId?: number; }
export interface PurgeProjectRequest { type: 'purge-project'; projectId: string; requestId?: number; }
// File upload: raw bytes arrive as base64 over WebSocket (no multipart available).
export interface CreateProjectFromFileRequest {
  type: 'create-project-from-file';
  name: string;
  contentType: 'pdf' | 'image';
  fileName: string;
  data: string;   // base64-encoded file bytes
  requestId?: number;
}
export interface UploadAssetRequest {
  type: 'upload-asset';
  projectId: string;
  mimeType: string;
  data: string;   // base64
  requestId?: number;
}
export interface AddScreenRequest { type: 'add-screen'; route: string; label: string; requestId?: number; }
export interface AddCommentRequest { type: 'add-comment'; screenId: string; anchor: CommentAnchor; text: string; requestId?: number; }
export interface DeleteCommentRequest { type: 'delete-comment'; commentId: string; requestId?: number; }
export interface ProxyUrlRequest { type: 'proxy-url'; url: string; requestId?: number; }
export interface UploadShareRequest { type: 'upload-share'; snapshot: unknown; coverNote: string; contentType: string; oldShareId?: string; oldRevokeToken?: string; requestId?: number; }
export interface CloudStatusRequest { type: 'cloud-status'; requestId?: number; }
export interface SaveSnapshotRequest { type: 'save-snapshot'; html: string; screenshot: string | null; trigger: 'manual' | 'share' | 'ai-applied'; triggeredBy?: string; requestId?: number; }
export interface SaveCanvasSnapshotRequest {
  type: 'save-canvas-snapshot';
  canvasState: string;           // JSON blob from serializeContent
  thumbnail?: string | null;     // data URL (or raw base64)
  trigger: 'manual' | 'share' | 'ai-applied';
  triggeredBy?: string;
  requestId?: number;
}
export interface ListSnapshotsRequest { type: 'list-snapshots'; requestId?: number; }
export interface StarSnapshotRequest { type: 'star-snapshot'; snapshotId: string; label: string; requestId?: number; }
export interface CurateCommentRequest { type: 'curate-comment'; commentIds: string[]; action: 'approve' | 'dismiss' | 'remix' | 'batch' | 'reset'; remixedText?: string; dismissReason?: string; requestId?: number; }
export interface LogAiInstructionRequest { type: 'log-ai-instruction'; feedbackIds: string[]; curationIds: string[]; instruction: string; requestId?: number; }
export interface ExportProjectRequest { type: 'export-project'; requestId?: number; }
export interface ExportReportRequest { type: 'export-report'; format: 'markdown' | 'pdf'; requestId?: number; }

export type AppMessage =
  | ListProjectsRequest
  | LoadProjectRequest
  | CreateProjectRequest
  | DeleteProjectRequest
  | RenameProjectRequest
  | ArchiveProjectRequest
  | UnarchiveProjectRequest
  | TrashProjectRequest
  | RestoreProjectRequest
  | PurgeProjectRequest
  | CreateProjectFromFileRequest
  | UploadAssetRequest
  | AddScreenRequest
  | AddCommentRequest
  | DeleteCommentRequest
  | ProxyUrlRequest
  | UploadShareRequest
  | CloudStatusRequest
  | SaveSnapshotRequest
  | SaveCanvasSnapshotRequest
  | ListSnapshotsRequest
  | StarSnapshotRequest
  | CurateCommentRequest
  | LogAiInstructionRequest
  | ExportProjectRequest
  | ExportReportRequest
  | LoadCanvasStateRequest
  | SaveCanvasStateRequest
  | GetAiConfigRequest
  | SetAiApiKeyRequest
  | ClearAiApiKeyRequest
  | ListAiConversationsRequest
  | LoadAiConversationRequest
  | SendAiMessageRequest;

// ─── Daemon → App (WebSocket) ───────────────────────────────────────────────

export interface ProjectSummary {
  name: string;
  projectId: string;
  contentType: string;
  modified: string;
  commentCount: number;
  archived?: string;
  trashed?: string;
}

export interface ProjectListMessage {
  type: 'project-list';
  requestId?: number;
  projects: ProjectSummary[];
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
export interface ReportReadyMessage {
  type: 'report-ready';
  requestId?: number;
  format: 'markdown' | 'pdf';
  mimeType: string;
  data: string; // markdown text or base64-encoded PDF
}
export interface CanvasStateLoadedMessage { type: 'canvas-state-loaded'; requestId?: number; state: string | null; }
export interface CanvasStateSavedMessage { type: 'canvas-state-saved'; requestId?: number; }
export interface AssetUploadedMessage {
  type: 'asset-uploaded';
  requestId?: number;
  assetId: string;
  url: string;
  bytes: number;
}

export interface AiConfigMessage {
  type: 'ai-config';
  requestId?: number;
  providers: { claude: { configured: boolean } };
}

export interface AiConversationSummary {
  id: string;
  title: string;
  modified: string;
  messageCount: number;
  bytes: number;
  model: string;
  continuedFrom: string | null;
  capReached: boolean;
}

export interface AiConversationListMessage {
  type: 'ai-conversation-list';
  requestId?: number;
  conversations: AiConversationSummary[];
}

export interface AiConversationLoadedMessage {
  type: 'ai-conversation-loaded';
  requestId?: number;
  conversation: {
    id: string;
    title: string;
    created: string;
    modified: string;
    model: string;
    provider: string;
    continuedFrom: string | null;
    capReached: boolean;
    messages: Array<{ role: 'user' | 'assistant'; content: string; ts: string }>;
  };
}

// Streaming AI responses. A single user message produces:
//   ai-stream-started → ai-stream-delta (N times) → ai-stream-ended
//   (or ai-stream-error if the provider fails)
export interface AiStreamStartedMessage {
  type: 'ai-stream-started';
  requestId?: number;
  conversationId: string;
  model: string;
  contextTokens: number;
}
export interface AiStreamDeltaMessage {
  type: 'ai-stream-delta';
  conversationId: string;
  delta: string;
}
export interface AiStreamEndedMessage {
  type: 'ai-stream-ended';
  conversationId: string;
  fullText: string;
  capStatus: { softWarn: boolean; hardCap: boolean; bytes: number; messageCount: number };
}
export interface AiStreamErrorMessage {
  type: 'ai-stream-error';
  conversationId: string | null;
  error: string;
}
export interface ConversationFullMessage {
  type: 'conversation-full';
  requestId?: number;
  conversationId: string;
  reason: 'bytes' | 'messages';
}

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
  | ReportReadyMessage
  | CanvasStateLoadedMessage
  | CanvasStateSavedMessage
  | AssetUploadedMessage
  | AiConfigMessage
  | AiConversationListMessage
  | AiConversationLoadedMessage
  | AiStreamStartedMessage
  | AiStreamDeltaMessage
  | AiStreamEndedMessage
  | AiStreamErrorMessage
  | ConversationFullMessage;

// ─── Paths ──────────────────────────────────────────────────────────────────

export const FRANK_DIR = `${process.env.HOME}/.frank`;
export const PROJECTS_DIR = `${process.env.HOME}/.frank/projects`;
export const CONFIG_PATH = `${process.env.HOME}/.frank/config.json`;

export const WEBSOCKET_PORT = 42069;
export const HTTP_PORT = 42068;

// Marker used in CLAUDE.md to identify our injected block
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
