// bridge.ts — Thin WebSocket client used by the `frank mcp` subprocess to
// talk to the running Frank daemon. Every MCP tool call turns into one or
// more daemon WS messages; this module handles connection, requestId-keyed
// promise resolution, reconnection, and a hard timeout so a hung daemon
// can't freeze an AI turn indefinitely.
//
// The MCP subprocess is short-lived (spawned per AI session) but the daemon
// is persistent — so this is a very conventional request/response client.

import { WebSocket } from 'ws';
import type { DaemonMessage } from '../protocol.js';
import { WEBSOCKET_PORT } from '../protocol.js';

const DEFAULT_URL = `ws://localhost:${WEBSOCKET_PORT}`;
const REQUEST_TIMEOUT_MS = 30_000;

type Pending = { resolve: (msg: DaemonMessage) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class DaemonBridge {
  private ws: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private reqId = 0;
  private url: string;
  private readyPromise: Promise<void> | null = null;

  constructor(url: string = DEFAULT_URL) {
    this.url = url;
  }

  async connect(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        ws.on('open', () => resolve());
        ws.on('error', (err) => {
          if (!this.ws || this.ws.readyState === WebSocket.CONNECTING) {
            reject(err);
          }
        });
        ws.on('message', (data) => this.onMessage(data.toString()));
        ws.on('close', () => {
          this.ws = null;
          for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error('daemon connection closed'));
          }
          this.pending.clear();
        });
      } catch (e) {
        reject(e as Error);
      }
    });
    return this.readyPromise;
  }

  private onMessage(raw: string): void {
    let parsed: DaemonMessage;
    try { parsed = JSON.parse(raw) as DaemonMessage; }
    catch { return; }
    const id = (parsed as { requestId?: number }).requestId;
    if (typeof id !== 'number') return;  // broadcasts ignored; we only react to replies
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(parsed);
  }

  // Send a request and await its keyed reply. Errors surface as `type: 'error'`
  // replies from the daemon — callers decide whether to throw or map them.
  //
  // The message shape is loosely typed here because AppMessage is a
  // discriminated union and per-type `projectId` optionality doesn't
  // intersect cleanly. Callers are responsible for matching the daemon's
  // protocol; wrong shapes come back as `type: 'error'` replies anyway.
  async send(msg: { type: string; [key: string]: unknown }): Promise<DaemonMessage> {
    await this.connect();
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('daemon not connected');
    const requestId = ++this.reqId;
    const payload = { ...msg, requestId };
    return new Promise<DaemonMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`daemon request timed out after ${REQUEST_TIMEOUT_MS}ms: ${msg.type}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify(payload));
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
