// Per-share asset-cache + state-promotion decision. Keeps track of which
// assets have been sent on each active share so subsequent pushes can go as
// lean `diff` events (canvas JSON only, no assets) and force a full `state`
// only when a new asset appears OR when the snapshot has drifted >30s stale.
//
// Why state-promotion matters: the backend-stored snapshot is overwritten only
// by `state` events. Diffs go to the rolling buffer but don't replace the
// snapshot. A cold-opening viewer always reads the snapshot first, so if we
// only ever sent diffs the snapshot would drift increasingly stale. Promoting
// to state every 30 seconds bounds that drift.

export interface CanvasPayloadIn {
  canvasState: string;
  assets: Record<string, string>;
}

export type CanvasSendDecision =
  | { kind: 'state'; payload: CanvasPayloadIn }
  | { kind: 'diff'; payload: CanvasPayloadIn };

interface SendState {
  sentAssets: Set<string>;
  lastStateAt: number;
  hasSentInitial: boolean;
}

const STATE_PROMOTION_MS = Number(process.env.FRANK_STATE_PROMOTION_MS || 30_000);

const states = new Map<string, SendState>();

function getOrCreate(shareId: string): SendState {
  let s = states.get(shareId);
  if (!s) {
    s = { sentAssets: new Set(), lastStateAt: 0, hasSentInitial: false };
    states.set(shareId, s);
  }
  return s;
}

export function decideCanvasSend(shareId: string, payload: CanvasPayloadIn): CanvasSendDecision {
  const state = getOrCreate(shareId);
  const currentAssets = new Set(Object.keys(payload.assets));

  const hasNewAsset = [...currentAssets].some((url) => !state.sentAssets.has(url));
  const stale = Date.now() - state.lastStateAt > STATE_PROMOTION_MS;

  if (!state.hasSentInitial || hasNewAsset || stale) {
    state.sentAssets = currentAssets;
    state.lastStateAt = Date.now();
    state.hasSentInitial = true;
    return { kind: 'state', payload };
  }

  return {
    kind: 'diff',
    payload: { canvasState: payload.canvasState, assets: {} },
  };
}

export function clearSendState(shareId: string): void {
  states.delete(shareId);
}

// Test helper.
export function __resetForTests(): void {
  states.clear();
}
