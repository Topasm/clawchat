import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectResponse, TodoResponse } from '../../types/api';
import type { InboxRouting } from '../../types/schemas';
import { useToastStore } from '../../stores/useToastStore';
import InboxPage from '../InboxPage';

const mocks = vi.hoisted(() => ({
  todos: [] as unknown[],
  projects: [] as unknown[],
  routings: [] as unknown[],
  candidates: [] as unknown[],
  move: vi.fn(),
  createTodo: vi.fn(),
  createProject: vi.fn(),
  placeTodo: vi.fn(),
  noteAction: vi.fn(),
  invalidateQueries: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../../hooks/queries', () => ({
  queryKeys: {
    todos: ['todos'],
    inboxRoutings: ['inbox-routings'],
    inboxProjectCandidates: ['inbox-project-candidates'],
  },
  useTodosQuery: () => ({ data: mocks.todos }),
  useProjectsQuery: () => ({ data: mocks.projects }),
  useInboxRoutingsQuery: () => ({ data: { items: mocks.routings, auto_organize: true } }),
  useInboxProjectCandidatesQuery: () => ({ data: mocks.candidates }),
  useInboxMove: () => ({ mutateAsync: mocks.move, isPending: false }),
  useCreateTodo: () => ({ mutateAsync: mocks.createTodo, isPending: false }),
  useCreateProject: () => ({ mutate: mocks.createProject, isPending: false }),
  useTaskGraphInsightsQuery: () => ({ data: { graph_revision: 7 }, refetch: vi.fn() }),
  usePlaceTodo: () => ({ mutateAsync: mocks.placeTodo, isPending: false }),
  usePlaceTodosBatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUndoTodoPlacement: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('../../hooks/queries/useNoteQueries', () => ({
  useNoteAction: () => ({ mutate: mocks.noteAction, isPending: false }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

const TIMESTAMPS = { created_at: '2026-10-16T00:00:00Z', updated_at: '2026-10-16T00:00:00Z' };

function todo(overrides: Partial<TodoResponse> & Pick<TodoResponse, 'id' | 'title'>): TodoResponse {
  return {
    status: 'pending',
    sort_order: 0,
    inbox_state: 'none',
    ...TIMESTAMPS,
    ...overrides,
  } as TodoResponse;
}

function routing(
  overrides: Partial<InboxRouting> & Pick<InboxRouting, 'id' | 'kind'>,
): InboxRouting {
  return {
    origin: 'auto',
    todo_id: null,
    note_id: null,
    title: 'Item',
    original_title: 'Item',
    due_date: null,
    project_folder: null,
    created_at: '2026-10-16T01:00:00Z',
    reverted_at: null,
    ...overrides,
  };
}

const project = {
  id: 'project-1',
  title: 'GPU_Computing',
  status: 'active',
  root_task_id: 'root-1',
} as ProjectResponse;

const gpuTask = routing({
  id: 'route-gpu',
  kind: 'task',
  todo_id: 'todo-gpu',
  title: 'Gpu 컴퓨팅 과제',
  original_title: 'Gpu 컴퓨팅 과제 11월 3일',
  due_date: '2026-11-03T14:59:59Z',
  project_folder: '01_Projects/postech_coursework_2/GPU_Computing',
});
const ideaNote = routing({
  id: 'route-idea',
  kind: 'note',
  todo_id: 'todo-idea',
  note_id: 'note-idea',
  title: 'Lam 신호로 active vision GRU 학습',
});

function renderPage() {
  return render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>,
  );
}

describe('InboxPage', () => {
  beforeEach(() => {
    mocks.todos = [];
    mocks.projects = [];
    mocks.routings = [];
    mocks.candidates = [];
    mocks.move.mockReset().mockResolvedValue({});
    mocks.createTodo.mockReset();
    mocks.createProject.mockReset();
    mocks.placeTodo.mockReset();
    mocks.noteAction.mockReset();
    mocks.navigate.mockReset();
    mocks.invalidateQueries.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('shows only the input and an empty state when nothing is open', () => {
    renderPage();
    expect(screen.getByText('Inbox is clear. Write a task or a note below.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add to Inbox' })).toBeInTheDocument();
    // The old toggle, New button and batch suggestions are gone.
    expect(screen.queryByRole('button', { name: 'Notes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument();
  });

  it('lists what it just organized with where it went and one undo per row', () => {
    mocks.routings = [gpuTask, ideaNote];
    mocks.todos = [todo({ id: 'todo-gpu', title: 'Gpu 컴퓨팅 과제' })];
    renderPage();

    const organized = screen.getByRole('region', { name: /Just organized/ });
    const rows = within(organized).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Gpu 컴퓨팅 과제')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Task')).toBeInTheDocument();
    expect(within(rows[0]).getByText(/GPU_Computing/)).toBeInTheDocument();
    expect(within(rows[1]).getByText('Note')).toBeInTheDocument();
    expect(within(organized).getAllByRole('button', { name: 'Undo' })).toHaveLength(2);
    expect(screen.getByText('Nothing to check')).toBeInTheDocument();

    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Undo' }));
    expect(mocks.move).toHaveBeenCalledWith({ action: 'undo', routingId: 'route-gpu' });
  });

  it('says where an undone item went, by its original text', async () => {
    const fromNote = routing({
      id: 'route-from-note',
      kind: 'task',
      todo_id: 'todo-from-note',
      note_id: 'note-from-note',
      title: 'From a note',
      original_title: 'From a note',
    });
    mocks.routings = [gpuTask, ideaNote, fromNote];
    mocks.move.mockImplementation(async ({ routingId }: { routingId: string }) =>
      mocks.routings.find((r) => (r as InboxRouting).id === routingId),
    );
    renderPage();
    const rows = within(screen.getByRole('region', { name: /Just organized/ })).getAllByRole(
      'listitem',
    );
    for (const row of rows) fireEvent.click(within(row).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(3));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Undone. “Gpu 컴퓨팅 과제 11월 3일” is back in the Inbox',
      'Undone. “Item” is back in the Inbox',
      'Undone. “From a note” is a note again',
    ]);
  });

  it('shows a failed undo as an error, not silently', async () => {
    mocks.routings = [gpuTask];
    mocks.move.mockRejectedValue({ response: { status: 409, data: {} } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => [t.type, t.message])).toEqual([
        ['error', 'Could not undo after later task changes'],
      ]),
    );
  });

  it('marks an item filed with low confidence and leaves sure ones plain', () => {
    mocks.routings = [
      { ...gpuTask, kind_confidence: null },
      { ...ideaNote, kind_confidence: 0.4 },
    ];
    renderPage();
    const unsure = screen.getByRole('button', { name: 'Lam 신호로 active vision GRU 학습' });
    expect(unsure).toHaveClass('cc-inbox-row__title--unsure');
    expect(unsure).toHaveAttribute('title', 'Filed with low confidence. Check where it went.');
    expect(screen.getByRole('button', { name: 'Gpu 컴퓨팅 과제' })).not.toHaveClass(
      'cc-inbox-row__title--unsure',
    );
  });

  it('changes a filed item from its destination menu', () => {
    mocks.routings = [gpuTask, ideaNote];
    mocks.projects = [project];
    renderPage();

    const [taskRow, noteRow] = within(
      screen.getByRole('region', { name: /Just organized/ }),
    ).getAllByRole('listitem');
    fireEvent.click(within(taskRow).getByRole('button', { name: 'Change where this goes' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Note' }));
    expect(mocks.move).toHaveBeenCalledWith({ action: 'to-note', todoId: 'todo-gpu' });

    fireEvent.click(within(taskRow).getByRole('button', { name: 'Change where this goes' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Project · GPU_Computing' }));
    expect(mocks.placeTodo).toHaveBeenCalledWith({
      id: 'todo-gpu',
      placement: expect.objectContaining({
        project_id: 'project-1',
        parent_id: null,
        expected_graph_revision: 7,
      }),
    });

    fireEvent.click(within(noteRow).getByRole('button', { name: 'Change where this goes' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Task' }));
    expect(mocks.move).toHaveBeenCalledWith({ action: 'to-task', noteId: 'note-idea' });
  });

  it('offers task or note for captures it was unsure about, and lists one still organizing apart', () => {
    mocks.todos = [
      todo({ id: 'unsure', title: '선택지 만드는 모델', inbox_state: 'captured' }),
      todo({ id: 'busy', title: 'Just captured', inbox_state: 'classifying' }),
      todo({ id: 'done', title: 'Finished', inbox_state: 'captured', status: 'completed' }),
    ];
    renderPage();

    // Still being read: its own section, not counted as a failure.
    const organizing = screen.getByRole('region', { name: /^Organizing/ });
    const busyRow = within(organizing).getByRole('listitem');
    expect(within(busyRow).getByText('Just captured')).toBeInTheDocument();
    expect(within(busyRow).getByText('Organizing…')).toBeInTheDocument();
    expect(within(busyRow).queryByRole('button', { name: 'Task' })).not.toBeInTheDocument();

    const review = screen.getByRole('region', { name: /Couldn't sort/ });
    expect(within(review).getByText('1')).toBeInTheDocument();
    const rows = within(review).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    const unsureRow = rows[0];
    fireEvent.click(within(unsureRow).getByRole('button', { name: 'Note' }));
    expect(mocks.move).toHaveBeenCalledWith({ action: 'to-note', todoId: 'unsure' });
    fireEvent.click(within(unsureRow).getByRole('button', { name: 'Task' }));
    expect(mocks.move).toHaveBeenCalledWith({ action: 'file-as-task', todoId: 'unsure' });
  });

  it('selects with Shift-click and files the selection together', async () => {
    mocks.todos = [
      todo({ id: 'a', title: 'First', inbox_state: 'captured' }),
      todo({ id: 'b', title: 'Second', inbox_state: 'captured' }),
    ];
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'First' }), { shiftKey: true });
    expect(mocks.navigate).not.toHaveBeenCalled();
    const bar = screen.getByRole('toolbar', { name: 'Selected' });
    expect(within(bar).getByText('1 selected')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Select all' }));
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Note' }));

    await waitFor(() => expect(mocks.move).toHaveBeenCalledTimes(2));
    expect(mocks.move).toHaveBeenNthCalledWith(1, { action: 'to-note', todoId: 'a' });
    expect(mocks.move).toHaveBeenNthCalledWith(2, { action: 'to-note', todoId: 'b' });
  });

  it('opens a capture on a plain click', () => {
    mocks.todos = [todo({ id: 'a', title: 'First', inbox_state: 'captured' })];
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/tasks/a');
  });

  it('adds to the Inbox from the bottom bar', async () => {
    mocks.createTodo.mockResolvedValue(
      todo({ id: 'new', title: 'Gpu 컴퓨팅 과제', due_date: '2026-11-03T14:59:59Z' }),
    );
    renderPage();
    const input = screen.getByRole('textbox', { name: 'Add to Inbox' });
    fireEvent.change(input, { target: { value: 'Gpu 컴퓨팅 과제 11월 3일' } });
    fireEvent.submit(input);

    expect(mocks.createTodo).toHaveBeenCalledWith({
      title: 'Gpu 컴퓨팅 과제 11월 3일',
      source: 'quick_capture',
      inbox_state: 'classifying',
    });
    await waitFor(() => expect(input).toHaveValue(''));
  });
});
