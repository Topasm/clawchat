/**
 * WebSocket client singleton for real-time server communication.
 * Handles auto-reconnect with exponential backoff.
 */

import type { ConnectionStatus } from '../stores/useAuthStore';

type MessageHandler = (data: unknown) => void;
type StatusChangeHandler = (status: ConnectionStatus) => void;

const KEEPALIVE_INTERVAL = 20000;
const LIVENESS_TIMEOUT = 90000;

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
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private livenessTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageTime: number = 0;
  onDisconnect: (() => void) | null = null;
  onAuthFailure: (() => void) | null = null;

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
    this.startWatchdog();
  }

  disconnect(): void {
    this.stopWatchdog();
    this.shouldReconnect = false;
    this._stopKeepalive();
    this._stopLivenessCheck();
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
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    const wsUrl = this.serverUrl.replace(/^http/, 'ws') + `/ws?token=${encodeURIComponent(this.token)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectDelay = 1000;
        this.lastMessageTime = 0;
        this._emitStatus('connected');
        this._startKeepalive();
        this._startLivenessCheck();
      };

      this.ws.onmessage = (event) => {
        this.lastMessageTime = Date.now();
        try {
          const msg = JSON.parse(event.data);
          const type = msg.type as string;
          // Server liveness signals — already tracked via lastMessageTime, skip dispatch
          if (type === 'tick' || type === 'heartbeat' || type === 'pong') return;
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

      this.ws.onclose = (event) => {
        this._stopKeepalive();
        this._stopLivenessCheck();
        this.ws = null;

        // Server rejected auth (code 4001) — stop reconnecting and notify
        if (event.code === 4001) {
          this.shouldReconnect = false;
          this.stopWatchdog();
          this._emitStatus('disconnected');
          this.onAuthFailure?.();
          return;
        }

        this.onDisconnect?.();
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

  private _startKeepalive(): void {
    this._stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'ping' }));
        } catch {
          this.ws.close();
          this._scheduleReconnect();
        }
      }
    }, KEEPALIVE_INTERVAL);
  }

  private _stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  private _startLivenessCheck(): void {
    this._stopLivenessCheck();
    this.livenessTimer = setInterval(() => {
      if (this.lastMessageTime > 0 && Date.now() - this.lastMessageTime > LIVENESS_TIMEOUT) {
        console.warn('Server liveness timeout — forcing reconnect');
        this.ws?.close();
      }
    }, 30000);
  }

  private _stopLivenessCheck(): void {
    if (this.livenessTimer) {
      clearInterval(this.livenessTimer);
      this.livenessTimer = null;
    }
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (
        this.shouldReconnect &&
        this.ws?.readyState !== WebSocket.OPEN &&
        this.ws?.readyState !== WebSocket.CONNECTING &&
        this.reconnectTimer === null
      ) {
        this._connect();
      }
    }, 30000);
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
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
