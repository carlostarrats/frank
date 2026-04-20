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
  // Bandwidth throttle transitions. true = entered throttle, false = cleared.
  // Separate from onError to keep the "throttled" UX distinct from genuine errors.
  onBandwidthStatus?: (throttled: boolean) => void;
  // Per-controller bandwidth overrides. Default to the module-level env-driven
  // defaults (3 MB burst / 10s, 1 MB sustained / 60s) which match the v3
  // direction doc. Tests use these to isolate which constraint is binding by
  // making the non-tested constraint effectively unlimited.
  burstCapBytes?: number;
  burstWindowMs?: number;
  sustainedCapBytes?: number;
  sustainedWindowMs?: number;
}

const SESSION_MAX_MS = Number(process.env.FRANK_SESSION_MAX_MS || 2 * 60 * 60 * 1000);
const BURST_WINDOW_MS = Number(process.env.FRANK_BURST_WINDOW_MS || 10_000);
const BURST_CAP_BYTES = Number(process.env.FRANK_BURST_CAP_BYTES || 3 * 1024 * 1024);
const SUSTAINED_WINDOW_MS = Number(process.env.FRANK_SUSTAINED_WINDOW_MS || 60_000);
const SUSTAINED_CAP_BYTES = Number(process.env.FRANK_SUSTAINED_CAP_BYTES || 1 * 1024 * 1024);

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
  private bandwidthLog: Array<{ ts: number; bytes: number }> = [];
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private isThrottled = false;
  private burstCapBytes: number;
  private burstWindowMs: number;
  private sustainedCapBytes: number;
  private sustainedWindowMs: number;

  constructor(opts: LiveShareControllerOptions) {
    this.opts = opts;
    this.minIntervalMs = Math.max(30, Math.floor(1000 / Math.max(1, opts.ratePerSecond)));
    this.burstCapBytes = opts.burstCapBytes ?? BURST_CAP_BYTES;
    this.burstWindowMs = opts.burstWindowMs ?? BURST_WINDOW_MS;
    this.sustainedCapBytes = opts.sustainedCapBytes ?? SUSTAINED_CAP_BYTES;
    this.sustainedWindowMs = opts.sustainedWindowMs ?? SUSTAINED_WINDOW_MS;
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
      if (this.throttleTimer) { clearTimeout(this.throttleTimer); this.throttleTimer = null; }
      this.authorStream?.close();
      this.authorStream = null;
      this.opts.onSessionTimeout?.();
    }, SESSION_MAX_MS);
  }

  get revision(): number { return loadRevision(this.opts.projectId); }
  get viewers(): number { return this._viewers; }

  pushState(payload: unknown): void {
    if (this.stopped || this.paused) return;
    if (isBackendV2Only()) return;
    this.pending = { kind: 'state', payload };
    // If waiting on a bandwidth throttle, cancel and re-evaluate. A smaller
    // payload may fit in the remaining burst budget immediately.
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.scheduleFlush();
  }

  pushDiff(payload: unknown): void {
    if (this.stopped || this.paused) return;
    if (isBackendV2Only()) return;
    if (this.pending?.kind === 'state') return;
    this.pending = { kind: 'diff', payload };
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.scheduleFlush();
  }

  pause(): void {
    this.paused = true;
    // Cancel any pending retry (including the 1500ms transient-error retry
    // set by flush()) so paused = true really means "no outbound traffic."
    // flush() also guards on this.paused defensively in case a timer slips
    // through before pause() is called.
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (this.sessionTimer) { clearTimeout(this.sessionTimer); this.sessionTimer = null; }
    if (this.throttleTimer) { clearTimeout(this.throttleTimer); this.throttleTimer = null; }
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
    if (this.throttleTimer) { clearTimeout(this.throttleTimer); this.throttleTimer = null; }
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
    if (this.stopped || this.paused || !this.pending) return;
    const update = this.pending;
    this.pending = null;
    this.lastFlushAt = Date.now();

    const payloadBytes = JSON.stringify(update.payload).length;
    const delay = this.nextAvailableDelay(payloadBytes);
    if (delay > 0) {
      // Too big for the current window. Put the update back and schedule a
      // precise retry — not a polling loop.
      this.pending = update;
      this.setThrottled(true);
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        void this.flush();
      }, delay);
      return;
    }

    const rev = nextRevision(this.opts.projectId);
    const res = await postState(this.opts.shareId, {
      revision: rev,
      type: update.kind,
      payload: update.payload,
    });
    if ('error' in res && res.httpStatus === 404) {
      this.pending = null;
      this.opts.onError?.('v2-only-backend');
      this.opts.onAuthorStatus?.('ended');
      return;
    }
    if ('error' in res && res.httpStatus === 413) {
      // Payload too big for backend's per-request cap. Distinct from bandwidth
      // throttle — we do NOT retry. Pause until the user explicitly resumes.
      this.pending = null;
      this.paused = true;
      this.opts.onError?.('payload-too-large');
      return;
    }
    if ('error' in res && res.error === 'revision-behind' && res.currentRevision) {
      saveRevision(this.opts.projectId, res.currentRevision);
      this.pending = update;
      this.scheduleFlush();
      return;
    }
    if ('error' in res) {
      this.opts.onError?.(res.error);
      this.pending = update;
      this.flushTimer = setTimeout(() => void this.flush(), 1500);
      return;
    }

    // Success. Record bandwidth usage (rejections don't count), clear throttle,
    // persist revision. The `if (this.pending) this.scheduleFlush()` line below
    // is preserved from Phase 1 — it handles updates that arrived during this
    // in-flight POST and is NOT specific to the bandwidth change.
    saveRevision(this.opts.projectId, res.acceptedRevision);
    this.recordBandwidth(payloadBytes);
    this.setThrottled(false);
    if (this.pending) this.scheduleFlush();
  }

  private pruneBandwidth(now: number): void {
    this.bandwidthLog = this.bandwidthLog.filter((e) => now - e.ts < this.sustainedWindowMs);
  }

  // Returns ms to wait before `bytes` can be sent without exceeding either cap.
  // Zero means "send now."
  private nextAvailableDelay(bytes: number): number {
    const now = Date.now();
    this.pruneBandwidth(now);

    const burstEntries = this.bandwidthLog.filter((e) => now - e.ts < this.burstWindowMs);
    const burstUsed = burstEntries.reduce((s, e) => s + e.bytes, 0);
    let burstDelay = 0;
    if (burstUsed + bytes > this.burstCapBytes && burstEntries.length > 0) {
      const oldest = burstEntries[0];
      burstDelay = Math.max(0, oldest.ts + this.burstWindowMs - now);
    }

    const sustainedUsed = this.bandwidthLog.reduce((s, e) => s + e.bytes, 0);
    let sustainedDelay = 0;
    if (sustainedUsed + bytes > this.sustainedCapBytes && this.bandwidthLog.length > 0) {
      const oldest = this.bandwidthLog[0];
      sustainedDelay = Math.max(0, oldest.ts + this.sustainedWindowMs - now);
    }

    return Math.max(burstDelay, sustainedDelay);
  }

  private recordBandwidth(bytes: number): void {
    this.bandwidthLog.push({ ts: Date.now(), bytes });
  }

  private setThrottled(state: boolean): void {
    if (this.isThrottled === state) return;
    this.isThrottled = state;
    this.opts.onBandwidthStatus?.(state);
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
