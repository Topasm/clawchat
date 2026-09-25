import type { DraggableProps, DroppableProps } from '@hello-pangea/dnd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../../i18n';
import { useAuthStore } from '../../../stores/useAuthStore';
import InboxNotesPanel from '../InboxNotesPanel';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  drop: null as null | ((value: unknown) => void),
}));
vi.mock('../../../services/apiClient', () => ({ default: api }));
vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: typeof api.drop;
  }) => {
    api.drop = onDragEnd;
    return children;
  },
  Droppable: ({ children }: { children: DroppableProps['children'] }) =>
    children(
      { innerRef: () => {}, droppableProps: {}, placeholder: null } as Parameters<
        DroppableProps['children']
      >[0],
      { isDraggingOver: false } as Parameters<DroppableProps['children']>[1],
    ),
  Draggable: ({ children }: { children: DraggableProps['children'] }) =>
    children(
      { innerRef: () => {}, draggableProps: {}, dragHandleProps: {} } as Parameters<
        DraggableProps['children']
      >[0],
      {} as Parameters<DraggableProps['children']>[1],
      {} as Parameters<DraggableProps['children']>[2],
    ),
}));

const note = {
  id: 'n1',
  content: 'Reference\nFull text',
  project_id: null,
  created_at: 'now',
  updated_at: 'now',
};
function renderNotes() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <InboxNotesPanel projects={[{ id: 'p1', title: 'Research' }]} />
    </QueryClientProvider>,
  );
}

describe('Inbox notes', () => {
  beforeEach(async () => {
    await changeAppLanguage('en');
    useAuthStore.setState({ serverUrl: 'http://notes.test' });
    api.get.mockReset();
    api.post.mockReset();
    api.patch.mockReset();
    api.delete.mockReset();
    api.get.mockResolvedValue({ data: [note] });
  });

  it('keeps a failed capture and reuses its retry key', async () => {
    api.post.mockRejectedValue(new Error('offline'));
    renderNotes();
    fireEvent.change(screen.getByRole('textbox', { name: 'Write a note' }), {
      target: { value: 'New memo' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: 'Write a note' })).toHaveValue('New memo');
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[0][1].idempotency_key).toBe(
      api.post.mock.calls[1][1].idempotency_key,
    );
    expect(api.post.mock.calls[0][0]).toBe('/notes');
  });

  it('drops a note into a project and can undo its assignment', async () => {
    api.patch.mockResolvedValue({ data: { ...note, project_id: 'p1' } });
    renderNotes();
    await screen.findByText('Reference');
    fireEvent.change(screen.getByRole('combobox', { name: 'Move to project' }), {
      target: { value: 'p1' },
    });
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        '/notes/n1',
        { project_id: 'p1' },
        { queueOfflineMutation: false },
      ),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Undo move' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        '/notes/n1',
        { project_id: null },
        { queueOfflineMutation: false },
      ),
    );
  });

  it('wires drag destination to the same project move', async () => {
    api.patch.mockResolvedValue({ data: { ...note, project_id: 'p1' } });
    renderNotes();
    await screen.findByText('Reference');
    const { act } = await import('@testing-library/react');
    await act(async () => {
      api.drop?.({ draggableId: 'n1', destination: { droppableId: 'note-project:p1' } });
    });
    expect(api.patch).toHaveBeenCalledWith(
      '/notes/n1',
      { project_id: 'p1' },
      { queueOfflineMutation: false },
    );
  });
});
