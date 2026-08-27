/**
 * WebSocket client singleton for real-time server communication.
 * Handles auto-reconnect with exponential backoff.
 */

import type { ConnectionStatus } from '../stores/useAuthStore';
import { useAuthStore } from '../stores/useAuthStore';
import { markStartupPhase } from './startupPerformance';

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
  private ticketAbortController: AbortController | null = null;
  private connectionGeneration = 0;
  private relayUnsubscribe: (() => void) | null = null;
  onDisconnect: (() => void) | null = null;
  onAuthFailure: (() => void) | null = null;

  onStatusChange(callback: StatusChangeHandler): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  private _emitStatus(status: ConnectionStatus): void {
    if (status === 'connected') markStartupPhase('transport_ready');
    for (const cb of this.statusListeners) cb(status);
  }

  connect(serverUrl: string, token: string): void {
    const generation = ++this.connectionGeneration;
    this.shouldReconnect = false;
    this.ticketAbortController?.abort();
    this.ticketAbortController = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const previousSocket = this.ws;
    this.ws = null;
    previousSocket?.close(1000, 'Connection replaced');
    this.serverUrl = serverUrl;
    this.token = token;
    this.shouldReconnect = true;
    void this._connect(generation);
    this.startWatchdog();
  }

  disconnect(): void {
    this.connectionGeneration += 1;
    this.stopWatchdog();
    this.shouldReconnect = false;
    this.ticketAbortController?.abort();
    this.ticketAbortController = null;
    this._stopKeepalive();
    this._stopLivenessCheck();
    this.relayUnsubscribe?.();
    this.relayUnsubscribe = null;
    void import('./relayClient').then(({ relayClient }) => relayClient.disconnect());
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

  private async _connect(generation = this.connectionGeneration): Promise<void> {
    if (
      generation !== this.connectionGeneration ||
      !this.shouldReconnect ||
      this.ticketAbortController ||
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING
    )
      return;

    const serverUrl = this.serverUrl;
    const token = this.token;
    const abortController = new AbortController();
    this.ticketAbortController = abortController;

    try {
      const response = await fetch(`${serverUrl}/api/auth/ws-ticket`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: abortController.signal,
      });
      if (generation !== this.connectionGeneration || !this.shouldReconnect) return;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          this._handleAuthFailure(generation);
          return;
        }
        throw new Error(`WebSocket ticket request failed: ${response.status}`);
      }
      const { ticket } = (await response.json()) as { ticket: string };
      if (generation !== this.connectionGeneration || !this.shouldReconnect) return;
      if (typeof ticket !== 'string' || ticket.length === 0) {
        throw new Error('WebSocket ticket response did not include a ticket');
      }
      const wsUrl = serverUrl.replace(/^http/, 'ws') + `/ws?ticket=${encodeURIComponent(ticket)}`;
      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      socket.onopen = () => {
        if (generation !== this.connectionGeneration || this.ws !== socket) {
          socket.close(1000, 'Stale connection');
          return;
        }
        this.relayUnsubscribe?.();
        this.relayUnsubscribe = null;
        void import('./relayClient').then(({ relayClient }) => relayClient.unsubscribe());
        this.reconnectDelay = 1000;
        this.lastMessageTime = 0;
        this._emitStatus('connected');
        this._startKeepalive();
        this._startLivenessCheck();
      };

      socket.onmessage = (event) => {
        if (generation !== this.connectionGeneration || this.ws !== socket) return;
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

      socket.onclose = (event) => {
        if (generation !== this.connectionGeneration || this.ws !== socket) return;
        this._stopKeepalive();
        this._stopLivenessCheck();
        this.ws = null;

        // Server rejected auth (code 4001) — stop reconnecting and notify
        if (event.code === 4001) {
          this._handleAuthFailure(generation);
          return;
        }

        this.onDisconnect?.();
        if (this.shouldReconnect) {
          this._scheduleReconnect(generation);
        } else {
          this._emitStatus('disconnected');
        }
      };

      socket.onerror = () => {
        // onclose will fire after this
      };
    } catch (error) {
      if (
        abortController.signal.aborted ||
        generation !== this.connectionGeneration ||
        !this.shouldReconnect
      )
        return;
      const { relayUrl, hostId, hostPublicKey } = useAuthStore.getState();
      if (relayUrl && hostId && hostPublicKey) {
        const relayConfig = { relayUrl, hostId, hostPublicKey };
        const { relayClient } = await import('./relayClient');
        if (generation !== this.connectionGeneration || !this.shouldReconnect) return;
        try {
          await relayClient.subscribe(relayConfig, token);
          if (generation !== this.connectionGeneration || !this.shouldReconnect) return;
          this.relayUnsubscribe?.();
          this.relayUnsubscribe = relayClient.onEvent((message) => {
            if (generation !== this.connectionGeneration) return;
            if (message.type === 'relay_disconnected') {
              this._emitStatus('reconnecting');
              if (this.shouldReconnect) this._scheduleReconnect(generation);
              return;
            }
            if (message.type === 'auth_error') {
              this._handleAuthFailure(generation);
              return;
            }
            const handlers = this.listeners.get(message.type);
            if (handlers) for (const handler of handlers) handler(message.data);
          });
          this.reconnectDelay = 1000;
          this._emitStatus('connected');
          return;
        } catch {
          // Reconnect scheduling below covers both direct and relay paths.
        }
      }
      if (this.shouldReconnect) this._scheduleReconnect(generation);
    } finally {
      if (this.ticketAbortController === abortController) {
        this.ticketAbortController = null;
      }
    }
  }

  private _handleAuthFailure(generation: number): void {
    if (generation !== this.connectionGeneration) return;
    this.shouldReconnect = false;
    this.stopWatchdog();
    this.relayUnsubscribe?.();
    this.relayUnsubscribe = null;
    void import('./relayClient').then(({ relayClient }) => relayClient.disconnect());
    this._emitStatus('disconnected');
    this.onAuthFailure?.();
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

  private _scheduleReconnect(generation = this.connectionGeneration): void {
    if (generation !== this.connectionGeneration || !this.shouldReconnect || this.reconnectTimer)
      return;
    this._emitStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (generation !== this.connectionGeneration || !this.shouldReconnect) return;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      void this._connect(generation);
    }, this.reconnectDelay);
  }
}

export const wsClient = new WSClient();
