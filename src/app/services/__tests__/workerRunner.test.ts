import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkerStore } from '../../stores/useWorkerStore';
import { WorkerRunner } from '../workerRunner';

const apiMocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), put: vi.fn() }));
const workerMocks = vi.hoisted(() => ({
  run: vi.fn(),
  readContext: vi.fn(),
  worker: null as unknown,
}));

vi.mock('../apiClient', () => ({
  default: { post: apiMocks.post, get: apiMocks.get, put: apiMocks.put },
}));
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
    apiMocks.get.mockReset().mockResolvedValue({ data: [] });
    apiMocks.put.mockReset().mockResolvedValue({ data: {} });
    workerMocks.run.mockReset();
    workerMocks.readContext.mockReset().mockResolvedValue([]);
    workerMocks.worker = { run: workerMocks.run, readContext: workerMocks.readContext };
    useWorkerStore.getState().reset();
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

  it('heartbeats every minute while a claimed job is still running', async () => {
    let claimed = false;
    apiMocks.post.mockImplementation(async (url: string) => {
      if (url.includes('/register')) return { data: { id: 'host-1' } };
      if (url.includes('/jobs/claim')) {
        if (claimed) return { data: null };
        claimed = true;
        return { data: job };
      }
      return { data: null };
    });
    let finish!: (value: { output: string }) => void;
    workerMocks.run.mockReturnValue(
      new Promise<{ output: string }>((resolve) => {
        finish = resolve;
      }),
    );
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude' });

    await runner.start();
    await vi.advanceTimersByTimeAsync(0);
    const heartbeatCalls = () =>
      apiMocks.post.mock.calls.filter(([url]) => url === '/runs/run-1/heartbeat').length;

    expect(heartbeatCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatCalls()).toBe(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatCalls()).toBe(3);

    finish({ output: 'Done' });
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(heartbeatCalls()).toBe(3);
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

  // The server never reads this disk, so checking in is when it first hears
  // what the folders bound here look like.
  it('describes every folder bound to this machine right after checking in', async () => {
    respondTo('/jobs/claim', null);
    apiMocks.get.mockResolvedValue({
      data: [
        { project_id: 'project-1', path: '/Users/me/papers', context_updated_at: null },
        { project_id: 'project-2', path: '/Users/me/lab', context_updated_at: null },
      ],
    });
    workerMocks.readContext.mockResolvedValue([{ path: 'README.md', text: '# Papers' }]);
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude' });

    await runner.start();
    runner.stop();

    expect(apiMocks.get).toHaveBeenCalledWith('/execution-hosts/host-1/paths');
    expect(workerMocks.readContext).toHaveBeenCalledWith('/Users/me/papers');
    expect(apiMocks.put).toHaveBeenCalledWith('/projects/project-1/workspace/context', {
      host_id: 'host-1',
      files: [{ path: 'README.md', text: '# Papers' }],
    });
    expect(apiMocks.put).toHaveBeenCalledWith(
      '/projects/project-2/workspace/context',
      expect.anything(),
    );
  });

  it('re-describes the folder before running work in it, and exposes itself to the UI', async () => {
    respondTo('/jobs/claim', { ...job, project_id: 'project-1' });
    workerMocks.run.mockResolvedValue({ output: 'Done' });
    const runner = new WorkerRunner({ label: 'MacBook', provider: 'claude' });

    await runner.start();
    expect(useWorkerStore.getState().hostId).toBe('host-1');
    expect(useWorkerStore.getState().refreshProjectContext).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    runner.stop();

    const contextCall = apiMocks.put.mock.calls.findIndex(
      ([url]) => url === '/projects/project-1/workspace/context',
    );
    expect(contextCall).toBeGreaterThanOrEqual(0);
    expect(workerMocks.run).toHaveBeenCalledTimes(1);
    expect(useWorkerStore.getState().hostId).toBeNull();
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
