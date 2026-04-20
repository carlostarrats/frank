// Per-share state-promotion decision for PDF live share. Mirrors
// image-send-state.ts structure — the PDF file is immutable during a session,
// so the only state-promotion triggers are "first push" and "≥30s since last
// state." Diffs carry comments only.

import type { Comment } from './protocol.js';

export interface PdfPayloadIn {
  fileDataUrl: string;
  mimeType: string;
  comments: Comment[];
}

export type PdfSendDecision =
  | { kind: 'state'; payload: PdfPayloadIn }
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

export function decidePdfSend(shareId: string, payload: PdfPayloadIn): PdfSendDecision {
  const state = getOrCreate(shareId);
  const elapsedMs = Date.now() - state.lastStateAt;
  const stale = elapsedMs > STATE_PROMOTION_MS;

  if (!state.hasSentInitial || stale) {
    const reason = !state.hasSentInitial ? 'first push' : `${Math.round(elapsedMs / 1000)}s since last state`;
    debug(`${shareId} pdf → state (${reason})`);
    state.lastStateAt = Date.now();
    state.hasSentInitial = true;
    return { kind: 'state', payload };
  }

  debug(`${shareId} pdf → diff (comments only, ${payload.comments.length} comments)`);
  return {
    kind: 'diff',
    payload: { comments: payload.comments },
  };
}

export function clearPdfSendState(shareId: string): void {
  states.delete(shareId);
}

// Test helper.
export function __resetForTests(): void {
  states.clear();
}
