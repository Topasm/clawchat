/**
 * WebSocket client singleton for real-time server communication.
 * Handles auto-reconnect with exponential backoff.
 */

import type { ConnectionStatus } from '../stores/useAuthStore';

type MessageHandler = (data: unknown) => void;
type StatusChangeHandler = (status: ConnectionStatus) => void;

class WSClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<MessageHandler>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private serverUrl = '';
  private token = '';
  private shouldReconnect = false;
  private statusListeners: Set<StatusChangeHandler> = new Set();

  onStatusChange(callback: StatusChangeHandler): () => void {
    this.statusListeners.add(callback);
    return () => { this.statusListeners.delete(callback); };
  }

  private _emitStatus(status: ConnectionStatus): void {
    for (const cb of this.statusListeners) cb(status);
  }

  connect(serverUrl: string, token: string): void {
    this.serverUrl = serverUrl;
    this.token = token;
    this.shouldReconnect = true;
    this._connect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._emitStatus('disconnected');
  }

  on(type: string, callback: MessageHandler): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(callback);
  }

  off(type: string, callback: MessageHandler): void {
    this.listeners.get(type)?.delete(callback);
  }

  private _connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(this.token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        this._emitStatus('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          const type = msg.type as string;
          const handlers = this.listeners.get(type);
          if (handlers) {
            for (const handler of handlers) {
              handler(msg.data);
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        if (this.shouldReconnect) {
          this._scheduleReconnect();
        } else {
          this._emitStatus('disconnected');
        }
      };

      this.ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      if (this.shouldReconnect) {
        this._scheduleReconnect();
      }
    }
  }

  private _scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this._emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this._connect();
    }, this.reconnectDelay);
  }
}

export const wsClient = new WSClient();
