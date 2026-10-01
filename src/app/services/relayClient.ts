export interface RelayConfig {
  relayUrl: string;
  hostId: string;
  hostPublicKey: string;
}

type RelayConfigCandidate = {
  relayUrl?: string | null;
  hostId?: string | null;
  hostPublicKey?: string | null;
};

export interface RelayHttpRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer | Uint8Array | null;
}

export interface RelayHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

type RelayEventHandler = (message: { type: string; data?: unknown }) => void;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PROTOCOL_LABEL = encoder.encode('clawchat-relay-v1');

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - (normalized.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function websocketUrl(relayUrl: string, hostId: string): string {
  const base = relayUrl
    .replace(/^http:/, 'ws:')
    .replace(/^https:/, 'wss:')
    .replace(/\/+$/, '');
  return `${base}/v1/relay/client/${encodeURIComponent(hostId)}`;
}

function requestBytes(body: RelayHttpRequest['body']): Uint8Array {
  if (body == null) return new Uint8Array();
  if (typeof body === 'string') return encoder.encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

class RelayClient {
  private socket: WebSocket | null = null;
  private config: RelayConfig | null = null;
  private encryptionKey: CryptoKey | null = null;
  private connectPromise: Promise<void> | null = null;
  private resolveConnect: (() => void) | null = null;
  private rejectConnect: ((error: Error) => void) | null = null;
  private pending = new Map<
    string,
    { resolve: (value: RelayHttpResponse) => void; reject: (error: Error) => void }
  >();
  private eventHandlers = new Set<RelayEventHandler>();
  private requestCounter = 0;
  private receivedNonces = new Set<string>();
  private nonceOrder: string[] = [];

  isConfigured(config: RelayConfigCandidate): config is RelayConfig {
    return Boolean(config.relayUrl && config.hostId && config.hostPublicKey);
  }

  async connect(config: RelayConfig): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.encryptionKey && this.sameConfig(config))
      return;
    if (this.connectPromise && this.sameConfig(config)) return this.connectPromise;

    this.disconnect();
    this.config = config;
    const connection = new Promise<void>((resolve, reject) => {
      this.resolveConnect = resolve;
      this.rejectConnect = reject;
    });
    this.connectPromise = connection;

    try {
      const keyPair = (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
        'deriveBits',
      ])) as CryptoKeyPair;
      const hostKey = await crypto.subtle.importKey(
        'raw',
        asArrayBuffer(decodeBase64(config.hostPublicKey)),
        { name: 'X25519' },
        false,
        [],
      );
      const sharedSecret = await crypto.subtle.deriveBits(
        { name: 'X25519', public: hostKey },
        keyPair.privateKey,
        256,
      );
      const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, [
        'deriveKey',
      ]);
      this.encryptionKey = await crypto.subtle.deriveKey(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: encoder.encode(config.hostId),
          info: PROTOCOL_LABEL,
        },
        hkdfKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
      const socket = new WebSocket(websocketUrl(config.relayUrl, config.hostId));
      this.socket = socket;
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            kind: 'hello',
            client_public_key: encodeBase64(publicKey),
          }),
        );
      socket.onmessage = (event) => {
        void this.handleFrame(event.data);
      };
      socket.onerror = () => {
        if (this.socket === socket) this.failConnection(new Error('Relay connection failed'));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.failConnection(new Error('Relay connection closed'));
      };
    } catch (error) {
      this.failConnection(error instanceof Error ? error : new Error('Relay setup failed'));
    }
    return connection;
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Client disconnect');
    this.encryptionKey = null;
    this.connectPromise = null;
    this.resolveConnect = null;
    this.rejectConnect = null;
    for (const pending of this.pending.values()) pending.reject(new Error('Relay disconnected'));
    this.pending.clear();
    this.receivedNonces.clear();
    this.nonceOrder = [];
  }

  onEvent(handler: RelayEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async subscribe(config: RelayConfig, token: string): Promise<void> {
    await this.connect(config);
    await this.sendEncrypted({ type: 'subscribe', token });
  }

  async unsubscribe(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN && this.encryptionKey) {
      await this.sendEncrypted({ type: 'unsubscribe' });
    }
  }

  async request(config: RelayConfig, request: RelayHttpRequest): Promise<RelayHttpResponse> {
    await this.connect(config);
    const id = `relay-${Date.now()}-${++this.requestCounter}`;
    const response = new Promise<RelayHttpResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Relay request timed out'));
      }, 120_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
    await this.sendEncrypted({
      type: 'http_request',
      id,
      method: request.method,
      path: request.path,
      headers: request.headers ?? {},
      body: encodeBase64(requestBytes(request.body)),
    });
    return response;
  }

  private async sendEncrypted(payload: object): Promise<void> {
    if (!this.encryptionKey || this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('Relay is not connected');
    }
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: PROTOCOL_LABEL },
      this.encryptionKey,
      encoder.encode(JSON.stringify(payload)),
    );
    this.socket.send(
      JSON.stringify({
        kind: 'encrypted',
        nonce: encodeBase64(nonce),
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      }),
    );
  }

  private async handleFrame(raw: string): Promise<void> {
    const frame = JSON.parse(raw);
    if (frame.kind === 'host_offline') {
      this.failConnection(new Error('ClawChat host is offline'));
      return;
    }
    if (frame.kind !== 'encrypted' || !this.encryptionKey) return;
    try {
      if (this.receivedNonces.has(frame.nonce)) throw new Error('Relay frame was replayed');
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: asArrayBuffer(decodeBase64(frame.nonce)),
          additionalData: PROTOCOL_LABEL,
        },
        this.encryptionKey,
        asArrayBuffer(decodeBase64(frame.ciphertext)),
      );
      const payload = JSON.parse(decoder.decode(plaintext));
      this.receivedNonces.add(frame.nonce);
      this.nonceOrder.push(frame.nonce);
      if (this.nonceOrder.length > 2048) {
        this.receivedNonces.delete(this.nonceOrder.shift()!);
      }
      if (payload.type === 'ready') {
        if (payload.host_id !== this.config?.hostId)
          throw new Error('Relay host identity mismatch');
        this.resolveConnect?.();
        this.resolveConnect = null;
        this.rejectConnect = null;
      } else if (payload.type === 'http_response') {
        const pending = this.pending.get(payload.id);
        if (!pending) return;
        this.pending.delete(payload.id);
        const bytes = decodeBase64(payload.body ?? '');
        const contentType = payload.headers?.['content-type'] ?? '';
        let data: unknown = bytes;
        if (contentType.includes('application/json')) {
          data = bytes.length ? JSON.parse(decoder.decode(bytes)) : null;
        } else if (contentType.startsWith('text/')) {
          data = decoder.decode(bytes);
        }
        pending.resolve({ status: payload.status, headers: payload.headers ?? {}, data });
      } else if (payload.type === 'event') {
        for (const handler of this.eventHandlers) handler(payload.data);
      } else if (payload.type === 'auth_error') {
        for (const handler of this.eventHandlers) handler({ type: 'auth_error' });
      }
    } catch (error) {
      this.failConnection(error instanceof Error ? error : new Error('Invalid relay frame'));
    }
  }

  private sameConfig(config: RelayConfig): boolean {
    return (
      this.config?.relayUrl === config.relayUrl &&
      this.config.hostId === config.hostId &&
      this.config.hostPublicKey === config.hostPublicKey
    );
  }

  private failConnection(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.encryptionKey = null;
    this.rejectConnect?.(error);
    this.rejectConnect = null;
    this.resolveConnect = null;
    this.connectPromise = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const handler of this.eventHandlers) handler({ type: 'relay_disconnected' });
  }
}

export const relayClient = new RelayClient();
