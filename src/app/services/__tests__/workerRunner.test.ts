import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerRunner } from '../workerRunner';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));
const workerMocks = vi.hoisted(() => ({ run: vi.fn(), worker: null as unknown }));

vi.mock('../apiClient', () => ({ default: { post: apiMocks.post } }));
vi.mock('../../platform', () => ({
  platformApi: {
    runtime: { os: 'darwin' },
    get worker() {
      return workerMocks.worker;
    },
  },
}));

function respondTo(path: string, data: unknown) {
  apiMocks.post.mockImplementation(async (url: string) => {
    if (url.includes(path)) return { data };
    if (url.includes('/register')) return { data: { id: 'host-1' } };
    return { data: null };
  });
}

const job = {
  run_id: 'run-1',
  instruction: 'Summarise the results',
  cwd: '/Users/me/papers',
  model: 'sonnet',
};

describe('WorkerRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiMocks.post.mockReset();
    workerMocks.run.mockReset();
    workerMocks.worker = { run: workerMocks.run };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers this machine before asking for work', async () => {
    respondTo('/jobs/claim', null);
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude' });

    await runner.start();
    runner.stop();

    const [path, body] = apiMocks.post.mock.calls[0];
    expect(path).toBe('/execution-hosts/register');
    expect(body).toEqual({ label: 'MacBook', platform: 'darwin' });
  });

  it('runs a claimed job here and reports the result', async () => {
    respondTo('/jobs/claim', job);
    workerMocks.run.mockResolvedValue({ output: 'Done' });
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude' });

    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();

    // The directory comes from the server, which recorded it for this machine.
    expect(workerMocks.run).toHaveBeenCalledWith({
      provider: 'claude',
      prompt: 'Summarise the results',
      cwd: '/Users/me/papers',
      model: 'sonnet',
    });
    expect(apiMocks.post).toHaveBeenCalledWith('/runs/run-1/result', { result: 'Done' });
  });

  // A failed run has to come back as a failure: leaving it started and silent
  // would strand it until the server's recovery path noticed.
  it('reports a failure rather than leaving the run started', async () => {
    respondTo('/jobs/claim', job);
    workerMocks.run.mockRejectedValue(new Error('claude is not installed on this machine'));
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude' });

    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();

    expect(apiMocks.post).toHaveBeenCalledWith('/runs/run-1/result', {
      error: 'claude is not installed on this machine',
    });
  });

  it('does not run anything on a surface with no shell', async () => {
    respondTo('/jobs/claim', job);
    workerMocks.worker = null;
    const runner = new WorkerRunner({ label: 'Browser', provider: 'claude' });

    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();

    expect(workerMocks.run).not.toHaveBeenCalled();
    expect(apiMocks.post).toHaveBeenCalledWith('/runs/run-1/result', {
      error: 'This machine cannot run work.',
    });
  });

  it('keeps polling after a failed poll instead of giving up', async () => {
    apiMocks.post.mockImplementation(async (url: string) => {
      if (url.includes('/register')) return { data: { id: 'host-1' } };
      throw new Error('offline');
    });
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude', pollIntervalMs: 100 });

    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    const afterFirst = apiMocks.post.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    runner.stop();

    expect(apiMocks.post.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it('stops asking once it is stopped', async () => {
    respondTo('/jobs/claim', null);
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude', pollIntervalMs: 100 });

    await runner.start();
    runner.stop();
    const calls = apiMocks.post.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);

    expect(apiMocks.post.mock.calls.length).toBe(calls);
  });
});
