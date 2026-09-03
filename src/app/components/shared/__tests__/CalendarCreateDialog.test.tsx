import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarCreateDialog from '../CalendarCreateDialog';

const apiMocks = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({
  default: { post: apiMocks.post },
}));

function renderDialog(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  render(<CalendarCreateDialog open onOpenChange={onOpenChange} initialDate="2026-09-01" />, {
    wrapper,
  });

  return { queryClient, onOpenChange };
}

function fillTitle(value: string) {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value } });
}

function switchToEvent() {
  fireEvent.click(screen.getByRole('button', { name: 'Event' }));
}

describe('CalendarCreateDialog', () => {
  beforeEach(() => {
    apiMocks.post.mockReset();
  });

  // The workspace is task-oriented, so a day picked on the calendar is a
  // deadline. Creating an event instead is the deliberate, secondary path.
  it('creates a task due on the picked day by default', async () => {
    apiMocks.post.mockResolvedValue({ data: { id: 'todo-1' } });
    renderDialog();

    fillTitle('Ship the release');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    const [path, payload] = apiMocks.post.mock.calls[0];
    expect(path).toBe('/todos');
    expect(payload).toMatchObject({ title: 'Ship the release' });
    expect(new Date(payload.due_date).getFullYear()).toBe(2026);
    expect(new Date(payload.due_date).getMonth()).toBe(8);
    expect(new Date(payload.due_date).getDate()).toBe(1);
  });

  // Regression: the dialog used to fabricate a `local-<timestamp>` event and
  // write it straight into the query cache without ever calling the server, so
  // a created event disappeared on the next refetch.
  it('sends a new event to the server', async () => {
    apiMocks.post.mockResolvedValue({ data: { id: 'evt-1' } });
    renderDialog();

    switchToEvent();
    fillTitle('Standup');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    const [path, payload] = apiMocks.post.mock.calls[0];
    expect(path).toBe('/events');
    expect(payload).toMatchObject({ title: 'Standup' });
    expect(payload.start_time).toEqual(expect.any(String));
    // Server-owned fields must never be invented by the client.
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('updated_at');
  });

  it('does not collect a location or a note on an event', () => {
    renderDialog();
    switchToEvent();

    expect(screen.queryByLabelText('Location')).toBeNull();
    expect(screen.queryByLabelText('Description')).toBeNull();
  });

  it('closes only after the server accepts the event', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    apiMocks.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    const { onOpenChange } = renderDialog();

    switchToEvent();
    fillTitle('Retro');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled());
    expect(onOpenChange).not.toHaveBeenCalled();

    resolvePost({ data: { id: 'evt-2' } });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog open when the request fails', async () => {
    apiMocks.post.mockRejectedValue(new Error('offline'));
    const { onOpenChange } = renderDialog();

    switchToEvent();
    fillTitle('Planning');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not submit an untitled entry', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiMocks.post).not.toHaveBeenCalled();
  });
});
