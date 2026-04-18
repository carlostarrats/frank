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
export interface ListScaffoldTemplatesRequest { type: 'list-scaffold-templates'; requestId?: number; }
export interface ScaffoldProjectRequest {
  type: 'scaffold-project';
  templateId: string;
  name: string;
  targetDir: string;            // absolute path; parent must be writable
  requestId?: number;
}
export interface StopScaffoldedServerRequest { type: 'stop-scaffolded-server'; projectId: string; requestId?: number; }
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
  | SaveCanvasStateRequest
  | GetAiConfigRequest
  | SetAiApiKeyRequest
  | ClearAiApiKeyRequest
  | ListAiConversationsRequest
  | LoadAiConversationRequest
  | SendAiMessageRequest
  | ListScaffoldTemplatesRequest
  | ScaffoldProjectRequest
  | StopScaffoldedServerRequest;

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

export interface ScaffoldTemplateSummary {
  id: string;
  name: string;
  description: string;
  needsInstall: boolean;
  estimatedInstallSeconds: number;
}
export interface ScaffoldTemplatesMessage {
  type: 'scaffold-templates';
  requestId?: number;
  templates: ScaffoldTemplateSummary[];
}

// Scaffold lifecycle. Stages announce what's happening:
//   created → installing → starting → ready (or error)
export interface ScaffoldStatusMessage {
  type: 'scaffold-status';
  requestId?: number;
  stage: 'created' | 'installing' | 'starting' | 'ready' | 'exited' | 'error';
  projectId: string;
  scaffoldPath?: string;
  url?: string;
  exitCode?: number | null;
  error?: string;
}
export interface ScaffoldLogMessage {
  type: 'scaffold-log';
  projectId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
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
  | CanvasStateLoadedMessage
  | CanvasStateSavedMessage
  | AiConfigMessage
  | AiConversationListMessage
  | AiConversationLoadedMessage
  | AiStreamStartedMessage
  | AiStreamDeltaMessage
  | AiStreamEndedMessage
  | AiStreamErrorMessage
  | ConversationFullMessage
  | ScaffoldTemplatesMessage
  | ScaffoldStatusMessage
  | ScaffoldLogMessage;

// ─── Paths ──────────────────────────────────────────────────────────────────

export const FRANK_DIR = `${process.env.HOME}/.frank`;
export const PROJECTS_DIR = `${process.env.HOME}/.frank/projects`;
export const CONFIG_PATH = `${process.env.HOME}/.frank/config.json`;

export const WEBSOCKET_PORT = 42069;
export const HTTP_PORT = 42068;

// Marker used in CLAUDE.md to identify our injected block
export const INJECT_MARKER_START = '<!-- FRANK:START -->';
export const INJECT_MARKER_END = '<!-- FRANK:END -->';
