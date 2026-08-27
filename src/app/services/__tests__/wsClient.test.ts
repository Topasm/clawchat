import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// We need to test the WSClient class, but it's a singleton.
// We'll test by importing and using the singleton instance.
// Since wsClient uses WebSocket, we need to mock it.

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    // Simulate async open
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }

  send(_data: string) {}
}

describe('wsClient', () => {
  let wsClient: typeof import('../wsClient').wsClient;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ticket: 'short-lived-ticket', expires_in: 60 }),
      }),
    );
    // Mock global WebSocket
    vi.stubGlobal('WebSocket', MockWebSocket);
    // Re-import to get fresh state... but it's a singleton
    // We'll disconnect before each test
    const mod = await import('../wsClient');
    wsClient = mod.wsClient;
    wsClient.disconnect();
  });

  afterEach(() => {
    wsClient.disconnect();
    wsClient.onAuthFailure = null;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects and fires connected status', async () => {
    const statusCb = vi.fn();
    wsClient.onStatusChange(statusCb);

    wsClient.connect('http://localhost:3000', 'token');

    // Trigger the async onopen
    await vi.advanceTimersByTimeAsync(10);

    expect(statusCb).toHaveBeenCalledWith('connected');
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/auth/ws-ticket', {
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      signal: expect.any(AbortSignal),
    });
    expect((wsClient as any).ws.url).toContain('/ws?ticket=short-lived-ticket');
  });

  it('stops reconnecting when the ticket request is unauthorized', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    const authFailure = vi.fn();
    wsClient.onAuthFailure = authFailure;

    wsClient.connect('http://localhost:3000', 'revoked-token');
    await vi.advanceTimersByTimeAsync(10);

    expect(authFailure).toHaveBeenCalledOnce();
    expect((wsClient as any).ws).toBeNull();
  });

  it('does not open a socket when a ticket arrives after disconnect', async () => {
    let resolveTicket!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTicket = resolve;
      }),
    );

    wsClient.connect('http://localhost:3000', 'old-token');
    wsClient.disconnect();
    resolveTicket({
      ok: true,
      status: 200,
      json: async () => ({ ticket: 'stale-ticket' }),
    } as Response);
    await vi.advanceTimersByTimeAsync(10);

    expect((wsClient as any).ws).toBeNull();
  });

  it('starts a fresh ticket request when credentials change', async () => {
    let resolveOldTicket!: (value: Response) => void;
    vi.mocked(fetch)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOldTicket = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ticket: 'new-ticket' }),
      } as Response);

    wsClient.connect('http://old-host', 'old-token');
    wsClient.connect('http://new-host', 'new-token');
    await vi.advanceTimersByTimeAsync(10);
    resolveOldTicket({
      ok: true,
      status: 200,
      json: async () => ({ ticket: 'old-ticket' }),
    } as Response);
    await vi.advanceTimersByTimeAsync(10);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect((wsClient as any).ws.url).toBe('ws://new-host/ws?ticket=new-ticket');
  });

  it('disconnect fires disconnected status', async () => {
    const statusCb = vi.fn();
    wsClient.onStatusChange(statusCb);

    wsClient.connect('http://localhost:3000', 'token');
    await vi.advanceTimersByTimeAsync(10);

    statusCb.mockClear();
    wsClient.disconnect();
    await vi.advanceTimersByTimeAsync(10);

    expect(statusCb).toHaveBeenCalledWith('disconnected');
  });

  it('dispatches messages to listeners', async () => {
    const handler = vi.fn();
    wsClient.on('test_event', handler);
    wsClient.connect('http://localhost:3000', 'token');

    await vi.advanceTimersByTimeAsync(10);

    // Simulate incoming message — access the internal WebSocket
    // We know the constructor creates a WebSocket, so we can access via the mock
    const instances = vi.mocked(WebSocket);
    // Manually trigger onmessage on the most recent instance
    const ws = (wsClient as any).ws as MockWebSocket;
    ws.onmessage?.({ data: JSON.stringify({ type: 'test_event', data: { key: 'value' } }) });

    expect(handler).toHaveBeenCalledWith({ key: 'value' });
  });

  it('off removes a listener', async () => {
    const handler = vi.fn();
    wsClient.on('test_event', handler);
    wsClient.off('test_event', handler);

    wsClient.connect('http://localhost:3000', 'token');
    await vi.advanceTimersByTimeAsync(10);

    const ws = (wsClient as any).ws as MockWebSocket;
    ws.onmessage?.({ data: JSON.stringify({ type: 'test_event', data: {} }) });

    expect(handler).not.toHaveBeenCalled();
  });

  it('onStatusChange returns an unsubscribe function', async () => {
    const statusCb = vi.fn();
    const unsub = wsClient.onStatusChange(statusCb);

    wsClient.connect('http://localhost:3000', 'token');
    await vi.advanceTimersByTimeAsync(10);
    expect(statusCb).toHaveBeenCalledWith('connected');

    unsub();
    statusCb.mockClear();

    wsClient.disconnect();
    await vi.advanceTimersByTimeAsync(10);
    expect(statusCb).not.toHaveBeenCalled();
  });

  it('schedules reconnect on close when shouldReconnect is true', async () => {
    const statusCb = vi.fn();
    wsClient.onStatusChange(statusCb);

    wsClient.connect('http://localhost:3000', 'token');
    await vi.advanceTimersByTimeAsync(10);

    statusCb.mockClear();

    // Simulate unexpected close (shouldReconnect is still true)
    const ws = (wsClient as any).ws as MockWebSocket;
    ws.onclose?.({ code: 1006, reason: '' });

    expect(statusCb).toHaveBeenCalledWith('reconnecting');
  });
});
