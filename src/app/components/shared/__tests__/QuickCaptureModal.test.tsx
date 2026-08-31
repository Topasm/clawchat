import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import QuickCaptureModal from '../QuickCaptureModal';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({
  default: { post: apiMocks.post },
}));

function renderModal() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );

  render(<QuickCaptureModal isOpen onClose={vi.fn()} />, { wrapper });
  return queryClient;
}

describe('QuickCaptureModal', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    useAuthStore.setState({ serverUrl: 'http://localhost:8000' });
  });

  it('persists an event through the server instead of fabricating a cache-only event', async () => {
    apiMocks.post.mockResolvedValue({
      data: {
        id: 'event-1',
        title: 'Team meeting',
        start_time: '2026-09-01T06:00:00.000Z',
        created_at: '2026-09-01T00:00:00.000Z',
        updated_at: '2026-09-01T00:00:00.000Z',
      },
    });
    const queryClient = renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Team meeting at 3pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    const [path, payload] = apiMocks.post.mock.calls[0];
    expect(path).toBe('/events');
    expect(payload).toMatchObject({ title: 'Team meeting', start_time: expect.any(String) });
    expect(payload).not.toHaveProperty('id');
    expect(queryClient.getQueryData(['events'])).toBeUndefined();
    await screen.findByText('Event created');
  });

  it('does not show a success receipt until the server accepts a task', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    apiMocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    renderModal();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Buy milk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Saved to Inbox')).not.toBeInTheDocument();

    resolvePost({ data: { id: 'todo-1', title: 'Buy milk' } });
    await screen.findByText('Saved to Inbox');
  });
});
