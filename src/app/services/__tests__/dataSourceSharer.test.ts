import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SharedSourceSetting } from '../../stores/useSettingsStore';
import { DataSourceSharer, toServerAnswer } from '../dataSourceSharer';

const apiMocks = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
const workerMocks = vi.hoisted(() => ({
  querySource: vi.fn(),
  indexSource: vi.fn(),
  worker: null as unknown,
}));

vi.mock('../apiClient', () => ({
  default: { post: apiMocks.post, put: apiMocks.put },
}));
vi.mock('../../platform', () => ({
  platformApi: {
    runtime: { os: 'darwin' },
    get worker() {
      return workerMocks.worker;
    },
  },
}));

const vault: SharedSourceSetting = {
  id: 'local-1',
  serverUrl: 'http://home:8000',
  root: '/Users/me/Google Drive/workspace',
  name: 'workspace',
  kind: 'obsidian_vault',
  includeFolders: ['00_Inbox', '01_Projects'],
  excludeFolders: ['01_Projects/Private'],
};

const claimed = {
  query_id: 'dq_1',
  source_id: 'dsrc_1',
  op: 'read',
  path: '00_Inbox/TODO.md',
  query: null,
  include_folders: ['00_Inbox', '01_Projects'],
  exclude_folders: ['02_Resources/Personal'],
};

/** Serve one request, then nothing; resolve once the answer is posted. */
function serveOnce(job: unknown) {
  let handed = false;
  let answered: (body: unknown) => void = () => undefined;
  const answer = new Promise<unknown>((resolve) => {
    answered = resolve;
  });
  apiMocks.post.mockImplementation(async (url: string, body: unknown) => {
    if (url === '/data-sources') return { data: { id: 'dsrc_1', host_id: 'host_1' } };
    if (url.endsWith('/data-queries/claim')) {
      if (handed) return new Promise(() => undefined);
      handed = true;
      return { data: job };
    }
    if (url.endsWith('/answer')) {
      answered(body);
      return { data: null };
    }
    throw new Error(`unexpected ${url}`);
  });
  return answer;
}

describe('DataSourceSharer', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    apiMocks.put.mockReset().mockResolvedValue({ data: null });
    workerMocks.querySource.mockReset();
    workerMocks.indexSource
      .mockReset()
      .mockResolvedValue([{ path: '00_Inbox/TODO.md', size: 12, modifiedAt: 1_760_000_000 }]);
    workerMocks.worker = {
      querySource: workerMocks.querySource,
      indexSource: workerMocks.indexSource,
    };
  });

  it('registers each folder without its path, sends names only, and answers a request', async () => {
    workerMocks.querySource.mockResolvedValue({
      ok: true,
      entries: [],
      matches: [],
      content: '- [ ] Email Kim',
      truncated: false,
    });
    const answered = serveOnce(claimed);
    const onRegistered = vi.fn();
    const sharer = new DataSourceSharer({
      label: 'MacBook',
      deviceId: '00000000-0000-0000-0000-000000000001',
      sources: [vault],
      onRegistered,
    });

    sharer.start();
    const body = await answered;
    sharer.stop();

    const registration = apiMocks.post.mock.calls.find(([url]) => url === '/data-sources')?.[1];
    expect(registration).toMatchObject({
      device_id: '00000000-0000-0000-0000-000000000001',
      host_label: 'MacBook',
      name: 'workspace',
      include_folders: ['00_Inbox', '01_Projects'],
      exclude_folders: ['01_Projects/Private'],
      // Neither the AI nor writes until the owner turns them on here.
      ai_access: false,
      allow_writes: false,
    });
    // The folder's location on this machine never leaves it.
    expect(JSON.stringify(registration)).not.toContain('/Users/me');
    expect(onRegistered).toHaveBeenCalledWith('local-1', 'dsrc_1');

    expect(apiMocks.put).toHaveBeenCalledWith('/data-sources/dsrc_1/index', {
      files: [
        {
          path: '00_Inbox/TODO.md',
          size: 12,
          modified_at: new Date(1_760_000_000_000).toISOString(),
        },
      ],
    });

    expect(workerMocks.querySource).toHaveBeenCalledWith({
      root: '/Users/me/Google Drive/workspace',
      op: 'read',
      path: '00_Inbox/TODO.md',
      query: null,
      includeFolders: ['00_Inbox', '01_Projects'],
      // What this machine holds back stays back even if Home forgot it.
      excludeFolders: ['02_Resources/Personal', '01_Projects/Private'],
      allowWrites: false,
    });
    expect(body).toMatchObject({ ok: true, content: '- [ ] Email Kim' });

    const claim = apiMocks.post.mock.calls.find(([url]) =>
      String(url).endsWith('/data-queries/claim'),
    );
    expect(claim?.[0]).toBe('/execution-hosts/host_1/data-queries/claim');
    expect(claim?.[2]).toMatchObject({ params: { wait: 20 } });
  });

  it("passes an approved write on with this machine's own write setting", async () => {
    workerMocks.querySource.mockResolvedValue({
      ok: true,
      entries: [],
      matches: [],
      truncated: false,
    });
    const answered = serveOnce({
      ...claimed,
      op: 'append_todo',
      query: '- [ ] Draft the abstract',
    });
    const sharer = new DataSourceSharer({
      label: 'MacBook',
      deviceId: '00000000-0000-0000-0000-000000000001',
      sources: [{ ...vault, aiAccess: true, allowWrites: true }],
    });

    sharer.start();
    const body = await answered;
    sharer.stop();

    const registration = apiMocks.post.mock.calls.find(([url]) => url === '/data-sources')?.[1];
    expect(registration).toMatchObject({ ai_access: true, allow_writes: true });
    expect(workerMocks.querySource).toHaveBeenCalledWith(
      expect.objectContaining({
        op: 'append_todo',
        path: '00_Inbox/TODO.md',
        query: '- [ ] Draft the abstract',
        allowWrites: true,
      }),
    );
    expect(body).toMatchObject({ ok: true });
  });

  it('answers a request for a folder it does not know with a refusal', async () => {
    const answered = serveOnce({ ...claimed, source_id: 'dsrc_other' });
    const sharer = new DataSourceSharer({
      label: 'MacBook',
      deviceId: '00000000-0000-0000-0000-000000000001',
      sources: [vault],
    });

    sharer.start();
    const body = await answered;
    sharer.stop();

    expect(body).toMatchObject({ ok: false, error: 'unknown_source' });
    expect(workerMocks.querySource).not.toHaveBeenCalled();
  });

  it('converts entries to the shape Home expects', () => {
    expect(
      toServerAnswer({
        ok: true,
        entries: [{ path: '01_Projects', isDir: true, size: null, modifiedAt: 0 }],
        matches: [{ path: 'a.md', snippet: 'hit', line: 3 }],
        truncated: true,
      }),
    ).toEqual({
      ok: true,
      error: null,
      entries: [
        {
          path: '01_Projects',
          is_dir: true,
          size: null,
          modified_at: '1970-01-01T00:00:00.000Z',
        },
      ],
      matches: [{ path: 'a.md', snippet: 'hit', line: 3 }],
      content: null,
      truncated: true,
    });
  });
});
