import { useEffect, useRef } from 'react';
import type { PanelMessage } from '../types/messages';

const WS_URL = 'ws://localhost:42069';
const RECONNECT_DELAY_MS = 3000;

// Connects to the Looky Loo daemon WebSocket and calls onMessage for each
// validated message. Automatically reconnects on disconnect.
export function useDaemonSocket(onMessage: (msg: PanelMessage) => void): void {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;

      ws = new WebSocket(WS_URL);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as PanelMessage;
          if (msg.type === 'render' || msg.type === 'clear') {
            onMessageRef.current(msg);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []); // Intentionally empty — connection is established once and self-manages
}
