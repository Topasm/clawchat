import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../../stores/useAuthStore';
import { useToastStore } from '../../../stores/useToastStore';
import QuickCaptureModal from '../QuickCaptureModal';

const apiMocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({
  default: { post: apiMocks.post, get: apiMocks.get },
}));

function renderModal(props: { defaultParentId?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onClose = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
  render(<QuickCaptureModal isOpen onClose={onClose} {...props} />, { wrapper });
  return { onClose };
}

describe('QuickCaptureModal', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
    apiMocks.get.mockReset();
    apiMocks.get.mockResolvedValue({ data: { items: [], total: 0 } });
    useAuthStore.setState({ serverUrl: 'http://localhost:8000' });
    useToastStore.setState({ toasts: [] });
  });

  it('is the Inbox input: one line and Enter adds it to the Inbox', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    apiMocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const { onClose } = renderModal();

    const input = screen.getByRole('textbox', { name: 'Add to Inbox' });
    expect(input).toHaveAttribute('placeholder', 'Write a task or a note');
    fireEvent.change(input, { target: { value: 'Buy milk' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    const [path, payload] = apiMocks.post.mock.calls[0];
    expect(path).toBe('/todos');
    expect(payload).toMatchObject({
      title: 'Buy milk',
      source: 'quick_capture',
      inbox_state: 'classifying',
    });
    expect(onClose).not.toHaveBeenCalled();

    resolvePost({ data: { id: 'todo-1', title: 'Buy milk', inbox_state: 'classifying' } });
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('adds a step to the task it was opened for', async () => {
    apiMocks.post.mockResolvedValue({ data: { id: 'todo-2', title: 'Read the paper' } });
    renderModal({ defaultParentId: 'todo-parent' });

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Read the paper' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    expect(apiMocks.post.mock.calls[0][1]).toMatchObject({
      title: 'Read the paper',
      parent_id: 'todo-parent',
      inbox_state: 'none',
    });
  });
});
