import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '../../stores/useAuthStore';
import DevicesPage from '../DevicesPage';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock('../../services/apiClient', () => ({ default: apiMocks }));

const vault = {
  id: 'dsrc_1',
  host_id: 'host_1',
  host_label: 'MacBook',
  kind: 'obsidian_vault',
  name: 'workspace',
  capabilities: ['list', 'read', 'search'],
  include_folders: ['00_Inbox', '01_Projects'],
  exclude_folders: [],
  is_online: true,
  last_seen_at: '2026-10-15T09:00:00Z',
  index_updated_at: '2026-10-15T09:00:00Z',
  indexed_files: 3,
  created_at: '2026-10-14T09:00:00Z',
};

function answer(body: Record<string, unknown>) {
  return {
    data: {
      origin: 'live',
      is_online: true,
      last_seen_at: '2026-10-15T09:00:00Z',
      entries: [],
      matches: [],
      truncated: false,
      ...body,
    },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DevicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DevicesPage', () => {
  beforeEach(() => {
    useAuthStore.setState({ serverUrl: 'http://home:8000', token: 'token' });
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
  });

  it('browses a shared vault and opens a TODO.md as a checklist', async () => {
    apiMocks.get.mockResolvedValue({ data: [vault] });
    apiMocks.post.mockImplementation(async (_url: string, body: { op: string; path?: string }) => {
      if (body.op === 'list' && !body.path) {
        return answer({
          op: 'list',
          path: '',
          entries: [
            { path: '00_Inbox', name: '00_Inbox', title: '00_Inbox', is_dir: true },
            { path: '01_Projects', name: '01_Projects', title: '01_Projects', is_dir: true },
          ],
        });
      }
      if (body.op === 'list') {
        return answer({
          op: 'list',
          path: '00_Inbox',
          entries: [{ path: '00_Inbox/TODO.md', name: 'TODO.md', title: 'TODO' }],
        });
      }
      return answer({
        op: 'read',
        path: '00_Inbox/TODO.md',
        content: '- [ ] Email Kim\n- [x] Book flights',
        tasks: [
          { title: 'Email Kim', status: 'pending', tags: [] },
          { title: 'Book flights', status: 'completed', tags: [] },
        ],
      });
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /00_Inbox\// }));
    fireEvent.click(await screen.findByRole('button', { name: /TODO/ }));

    expect(await screen.findByText('Email Kim')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Checklist' })).toBeInTheDocument();
    expect(apiMocks.post).toHaveBeenLastCalledWith(
      '/data-sources/dsrc_1/query',
      { op: 'read', path: '00_Inbox/TODO.md' },
      expect.anything(),
    );
  });

  it('shows the cached list of an offline machine and refuses to open files', async () => {
    apiMocks.get.mockResolvedValue({ data: [{ ...vault, is_online: false }] });
    apiMocks.post.mockImplementation(async (_url: string, body: { op: string }) => {
      if (body.op === 'list') {
        return answer({
          op: 'list',
          path: '',
          origin: 'cache',
          fallback_reason: 'offline',
          is_online: false,
          entries: [{ path: 'notes.md', name: 'notes.md', title: 'notes' }],
        });
      }
      throw {
        response: {
          status: 503,
          data: { error: { code: 'DATA_SOURCE_OFFLINE', message: 'offline' } },
        },
      };
    });

    renderPage();

    expect(await screen.findByRole('status')).toHaveTextContent(/Offline · last seen/);
    fireEvent.click(await screen.findByRole('button', { name: /notes/ }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/MacBook, which is offline/),
    );
  });

  it('explains how to share a folder when none is shared', async () => {
    apiMocks.get.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText(/No machine shares a folder yet/)).toBeInTheDocument();
  });
});
