import { nextRevision, saveRevision, loadRevision } from './revision-store.js';
import { postState, openAuthorStream, revokeShare, isBackendV2Only, AuthorStreamHandle } from './cloud.js';

export interface LiveShareControllerOptions {
  projectId: string;
  shareId: string;
  contentType: 'canvas' | 'image' | 'pdf' | 'url';
  // Upper bound on state-POSTs per second. Defaults match the direction doc:
  // canvas=15, pdf=5, image=1.
  ratePerSecond: number;
  // Author-stream event handlers. Wired by server.ts to broadcast on the
  // UI websocket.
  onComment?: (comment: unknown) => void;
  onPresence?: (viewers: number) => void;
  onAuthorStatus?: (status: 'online' | 'offline' | 'ended') => void;
  onShareEnded?: (reason: 'revoked' | 'expired') => void;
  onError?: (err: string) => void;
  // Auto-pause fires after 2h of continuous streaming. When the UI receives
  // this, the share popover should render this EXACT copy (wired in Phase 5):
  //   "Live share paused — sessions auto-pause after 2 hours to prevent
  //    accidental long-running sessions. Click Resume to continue."
  // Clock is daemon-local and resets on restart (restart = fresh session).
  onSessionTimeout?: () => void;
}

const SESSION_MAX_MS = Number(process.env.FRANK_SESSION_MAX_MS || 2 * 60 * 60 * 1000);

interface PendingUpdate {
  kind: 'state' | 'diff';
  payload: unknown;
}

export class LiveShareController {
  private opts: LiveShareControllerOptions;
  private pending: PendingUpdate | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;
  private authorStream: AuthorStreamHandle | null = null;
  private stopped = false;
  private minIntervalMs: number;
  private paused = false;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private _viewers = 0;

  constructor(opts: LiveShareControllerOptions) {
    this.opts = opts;
    this.minIntervalMs = Math.max(30, Math.floor(1000 / Math.max(1, opts.ratePerSecond)));
    this.openAuthor();
    this.armSessionTimer();
  }

  private armSessionTimer(): void {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      // Daemon-local 2h cap. Exists to prevent "left laptop open overnight"
      // accidents, not to police deliberate continuations — if the user
      // clicks Resume, a fresh 2h starts. Timer state is NOT persisted
      // across daemon restarts: restart = fresh session, matching user
      // intent when they relaunch Frank.
      this.paused = true;
      this.pending = null;
      this.authorStream?.close();
      this.authorStream = null;
      this.opts.onSessionTimeout?.();
    }, SESSION_MAX_MS);
  }

  get revision(): number { return loadRevision(this.opts.projectId); }
  get viewers(): number { return this._viewers; }

  pushState(payload: unknown): void {
    if (this.stopped || this.paused) return;
    if (isBackendV2Only()) return; // silently drop; retry on next start-live-share
    // Coalesce — latest state wins. This is the "don't replay history" rule.
    this.pending = { kind: 'state', payload };
    this.scheduleFlush();
  }

  pushDiff(payload: unknown): void {
    if (this.stopped || this.paused) return;
    if (isBackendV2Only()) return;
    // Diffs can't be coalesced the same way because each one is additive.
    // But if a `state` was pending, the state supersedes the diff.
    if (this.pending?.kind === 'state') return;
    this.pending = { kind: 'diff', payload };
    this.scheduleFlush();
  }

  pause(): void {
    this.paused = true;
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = null; }
    this.authorStream?.close();
    this.authorStream = null;
  }

  resume(): void {
    this.paused = false;
    this.openAuthor();
    this.armSessionTimer(); // fresh 2h clock
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.sessionTimer = null;
    this.authorStream?.close();
    this.authorStream = null;
  }

  async revoke(revokeToken: string): Promise<void> {
    await revokeShare(this.opts.shareId, revokeToken);
    await this.stop();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    const sinceLast = Date.now() - this.lastFlushAt;
    const wait = Math.max(this.minIntervalMs - sinceLast, 100); // min 100ms debounce
    this.flushTimer = setTimeout(() => void this.flush(), wait);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.stopped || !this.pending) return;
    const update = this.pending;
    this.pending = null;
    this.lastFlushAt = Date.now();

    const rev = nextRevision(this.opts.projectId);
    const res = await postState(this.opts.shareId, {
      revision: rev,
      type: update.kind,
      payload: update.payload,
    });
    if ('error' in res && res.httpStatus === 404) {
      // Backend is v2-only right now. Stop pushing, but DON'T permanently kill
      // the controller — if the backend is upgraded, the 5-min TTL lets us
      // retry. For now, surface 'unsupported' once and swallow queued updates.
      this.pending = null;
      this.opts.onError?.('v2-only-backend');
      this.opts.onAuthorStatus?.('ended');
      return;
    }
    if ('error' in res && res.error === 'revision-behind' && res.currentRevision) {
      // Fast-forward and retry this exact update at the new revision.
      saveRevision(this.opts.projectId, res.currentRevision);
      this.pending = update;
      this.scheduleFlush();
      return;
    }
    if ('error' in res) {
      this.opts.onError?.(res.error);
      // Keep the update and retry with backoff.
      this.pending = update;
      this.flushTimer = setTimeout(() => void this.flush(), 1500);
      return;
    }
    // Success — persist the accepted revision.
    saveRevision(this.opts.projectId, res.acceptedRevision);
    // If something queued up while we were sending, schedule again.
    if (this.pending) this.scheduleFlush();
  }

  private openAuthor(): void {
    this.authorStream = openAuthorStream(this.opts.shareId, {
      onComment: (c) => this.opts.onComment?.(c),
      onPresence: ({ viewers }) => {
        this._viewers = viewers;
        this.opts.onPresence?.(viewers);
      },
      onShareEnded: ({ reason }) => this.opts.onShareEnded?.(reason),
      onError: (err) => this.opts.onError?.(err),
      onReconnect: () => {
        this.opts.onAuthorStatus?.('online');
      },
      onClose: () => this.opts.onAuthorStatus?.('offline'),
    });
  }
}
