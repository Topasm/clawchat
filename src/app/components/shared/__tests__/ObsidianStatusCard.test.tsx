import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../../i18n';
import { useAuthStore } from '../../../stores/useAuthStore';
import ObsidianStatusCard from '../ObsidianStatusCard';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ default: api }));

const health = {
  vault_available: true,
  vault_path: '/vault',
  cli_available: false,
  companion_online: true,
  mode: 'filesystem',
  project_root: '01_Projects',
  index_state: 'ready',
  sync_mode: 'filesystem',
  project_count: 2,
  last_scan: 1,
  scan_duration_ms: 3,
  is_stale: false,
  error: null,
  write_queue: { pending: 0, operations: [] },
  bidirectional_sync: {
    last_scan: null,
    files_scanned: 0,
    markers_found: 0,
    changes_applied: 0,
    errors: 0,
    sync_lag_seconds: null,
  },
};

const projects = {
  projects: [
    {
      folder: '00_Inbox',
      name: '00_Inbox',
      has_todo: true,
      todo_md_preview: '',
      doc_count: 0,
      last_modified: null,
    },
    {
      folder: '01_Projects/Alpha',
      name: 'Alpha',
      has_todo: false,
      todo_md_preview: '',
      doc_count: 0,
      last_modified: null,
    },
  ],
  total: 2,
  project_root: '01_Projects',
  index_age_seconds: 1,
};

function renderCard(overrides: Partial<typeof health> = {}) {
  api.get.mockImplementation(async (url: string) => {
    if (url === '/obsidian/health') return { data: { ...health, ...overrides } };
    if (url === '/obsidian/projects') return { data: projects };
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ObsidianStatusCard />
    </QueryClientProvider>,
  );
}

describe('ObsidianStatusCard', () => {
  beforeEach(async () => {
    await changeAppLanguage('en');
    api.get.mockReset();
    api.put.mockReset();
    api.post.mockReset();
    useAuthStore.setState({ serverUrl: 'http://localhost:8000' });
  });

  it('saves the project root folder', async () => {
    api.put.mockResolvedValue({ data: { project_root: '10_Work', project_count: 4 } });
    renderCard();

    const input = await screen.findByDisplayValue('01_Projects');
    fireEvent.change(input, { target: { value: ' 10_Work ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/obsidian/project-root',
        { project_root: '10_Work' },
        { queueOfflineMutation: false },
      ),
    );
  });

  it('offers Create TODO.md only for projects without one', async () => {
    api.post.mockResolvedValue({ data: { ...projects.projects[1], has_todo: true } });
    renderCard();

    const buttons = await screen.findAllByRole('button', { name: 'Create TODO.md' });
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('01_Projects/Alpha')).toBeInTheDocument();
    fireEvent.click(buttons[0]);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/obsidian/projects/todo',
        { folder: '01_Projects/Alpha' },
        { queueOfflineMutation: false },
      ),
    );
  });

  it('shows the background index build and the mode', async () => {
    renderCard({ index_state: 'scanning' });

    expect(await screen.findByTestId('obsidian-indexing')).toHaveTextContent(
      'Indexing vault in the background',
    );
    expect(screen.getByText(/Mode: filesystem/)).toBeInTheDocument();
  });
});
