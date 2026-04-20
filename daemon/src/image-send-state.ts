// Per-share state-promotion decision for image live share. Simpler than canvas's
// send-state tracker because the image file is immutable — no "new asset"
// trigger. Promotion rules:
//   - First push of the session → state
//   - ≥ 30s since last state → state (keeps backend snapshot fresh)
//   - Otherwise → diff with comments only
//
// Why state-promotion matters: the backend-stored snapshot is overwritten only
// by `state` events. Diffs append to the rolling buffer but don't replace the
// snapshot. A cold-opening viewer reads the snapshot first, so if we only ever
// sent diffs the snapshot would drift increasingly stale. Promoting to state
// every 30 seconds bounds the drift.

import type { Comment } from './protocol.js';

export interface ImagePayloadIn {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

export type ImageSendDecision =
  | { kind: 'state'; payload: ImagePayloadIn }
  | { kind: 'diff'; payload: { comments: Comment[] } };

interface SendState {
  lastStateAt: number;
  hasSentInitial: boolean;
}

const STATE_PROMOTION_MS = Number(process.env.FRANK_STATE_PROMOTION_MS || 30_000);

const states = new Map<string, SendState>();

function getOrCreate(shareId: string): SendState {
  let s = states.get(shareId);
  if (!s) {
    s = { lastStateAt: 0, hasSentInitial: false };
    states.set(shareId, s);
  }
  return s;
}

const DEBUG = process.env.FRANK_DEBUG_LIVE_SHARE === '1';

function debug(msg: string): void {
  if (DEBUG) console.log(`[live-share] ${msg}`);
}

export function decideImageSend(shareId: string, payload: ImagePayloadIn): ImageSendDecision {
  const state = getOrCreate(shareId);
  const elapsedMs = Date.now() - state.lastStateAt;
  const stale = elapsedMs > STATE_PROMOTION_MS;

  if (!state.hasSentInitial || stale) {
    const reason = !state.hasSentInitial ? 'first push' : `${Math.round(elapsedMs / 1000)}s since last state`;
    debug(`${shareId} image → state (${reason})`);
    state.lastStateAt = Date.now();
    state.hasSentInitial = true;
    return { kind: 'state', payload };
  }

  debug(`${shareId} image → diff (comments only, ${payload.comments.length} comments)`);
  return {
    kind: 'diff',
    payload: { comments: payload.comments },
  };
}

export function clearImageSendState(shareId: string): void {
  states.delete(shareId);
}

// Test helper.
export function __resetForTests(): void {
  states.clear();
}
