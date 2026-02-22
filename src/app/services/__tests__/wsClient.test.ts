import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// We need to test the WSClient class, but it's a singleton.
// We'll test by importing and using the singleton instance.
// Since wsClient uses WebSocket, we need to mock it.

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    setTimeout(() => this.onclose?.(), 0);
  }

  send(_data: string) {}
}

describe('wsClient', () => {
  let wsClient: typeof import('../wsClient').wsClient;

  beforeEach(async () => {
    vi.useFakeTimers();
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
    ws.onclose?.();

    expect(statusCb).toHaveBeenCalledWith('reconnecting');
  });
});
