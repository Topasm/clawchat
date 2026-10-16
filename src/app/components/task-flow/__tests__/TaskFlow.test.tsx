import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodoResponse } from '../../../types/api';
import TaskFlow from '../TaskFlow';

const mocks = vi.hoisted(() => ({
  todos: [] as TodoResponse[],
  relationships: [] as {
    id: string;
    source_task_id: string;
    target_task_id: string;
    type: string;
  }[],
  addStep: vi.fn(),
  moveStep: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useTodosQuery: () => ({ data: mocks.todos }),
  useTaskRelationshipsQuery: () => ({ data: mocks.relationships }),
  useAddTaskStep: () => ({ mutateAsync: mocks.addStep }),
  useMoveTaskStep: () => ({ mutate: mocks.moveStep }),
  useToggleTodoComplete: () => ({ mutate: mocks.toggle }),
}));

function todo(id: string, overrides: Partial<TodoResponse> = {}): TodoResponse {
  return {
    id,
    title: id,
    status: 'pending',
    tags: [],
    inbox_state: 'none',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function edge(source: string, target: string) {
  return {
    id: `${source}-${target}`,
    source_task_id: source,
    target_task_id: target,
    type: 'depends_on',
  };
}

function renderFlow() {
  return render(
    <MemoryRouter>
      <TaskFlow rootId="hw" />
    </MemoryRouter>,
  );
}

describe('TaskFlow', () => {
  beforeEach(() => {
    mocks.addStep.mockReset().mockResolvedValue({});
    mocks.moveStep.mockReset();
    mocks.toggle.mockReset();
    mocks.todos = [
      todo('hw', { title: 'GPU homework' }),
      todo('read', { title: 'Read', parent_id: 'hw', sort_order: 0, status: 'completed' }),
      todo('kernel', { title: 'Write kernel', parent_id: 'hw', sort_order: 10 }),
      todo('submit', { title: 'Submit', parent_id: 'hw', sort_order: 20 }),
      todo('tile', { title: 'Tile loops', parent_id: 'kernel', sort_order: 0 }),
      todo('data', { title: 'Prepare data' }),
      todo('elsewhere', { title: 'Unrelated', parent_id: 'other' }),
    ];
    mocks.relationships = [edge('kernel', 'read'), edge('submit', 'kernel'), edge('read', 'data')];
  });

  it('draws only the task’s own steps, with outside prerequisites as tags', () => {
    renderFlow();
    const steps = screen.getByRole('list', { name: 'Steps' });

    expect(
      within(steps)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Read'),
      expect.stringContaining('Write kernel'),
      expect.stringContaining('Submit'),
    ]);
    expect(screen.queryByText('Unrelated')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other task: Prepare data' })).toBeVisible();
    expect(within(steps).getByText(/1 inside/)).toBeVisible();
    expect(screen.getByText('Can do now 1 · Blocked 0')).toBeVisible();
  });

  it('appends on Enter and branches from the selected step on Tab, one at a time', async () => {
    renderFlow();
    const input = screen.getByRole('textbox', { name: 'Next step' });

    fireEvent.change(input, { target: { value: 'Profile' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: /^Submit/ }));
    fireEvent.change(input, { target: { value: 'Draft report' } });
    fireEvent.keyDown(input, { key: 'Tab' });

    await waitFor(() => expect(mocks.addStep).toHaveBeenCalledTimes(2));
    expect(mocks.addStep).toHaveBeenNthCalledWith(1, {
      parentId: 'hw',
      title: 'Profile',
      branchFromId: null,
      afterId: null,
    });
    expect(mocks.addStep).toHaveBeenNthCalledWith(2, {
      parentId: 'hw',
      title: 'Draft report',
      branchFromId: 'submit',
      afterId: null,
    });
    expect(input).toHaveValue('');
  });

  it('drills into a step that has steps of its own and comes back by the trail', () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: /^Write kernel/ }));

    expect(screen.getByText('Tile loops')).toBeVisible();
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'GPU homework' }));
    expect(screen.getByText('Submit')).toBeVisible();
  });

  it('moves a step dropped on another right after it', () => {
    renderFlow();
    const [read, , submit] = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole(
      'listitem',
    );
    const dataTransfer = { setData: vi.fn(), getData: () => 'read', effectAllowed: '' };
    fireEvent.dragStart(read, { dataTransfer });
    fireEvent.drop(submit, { dataTransfer });

    expect(mocks.moveStep).toHaveBeenCalledWith({
      parentId: 'hw',
      stepId: 'read',
      afterId: 'submit',
    });
  });

  it('folds more than three done steps at the start into one box', () => {
    mocks.todos = [
      todo('hw', { title: 'GPU homework' }),
      ...['a', 'b', 'c', 'd'].map((id, index) =>
        todo(id, { title: `Done ${id}`, parent_id: 'hw', sort_order: index, status: 'completed' }),
      ),
      todo('next', { title: 'Next one', parent_id: 'hw', sort_order: 9 }),
    ];
    mocks.relationships = [edge('b', 'a'), edge('c', 'b'), edge('d', 'c'), edge('next', 'd')];
    renderFlow();

    expect(screen.queryByText('Done a')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done 4' }));
    expect(screen.getByText('Done a')).toBeVisible();
  });

  it('keeps steps with no order apart from the flow', () => {
    mocks.todos.push(todo('papers', { title: 'Find papers', parent_id: 'hw', sort_order: 99 }));
    renderFlow();

    const loose = screen.getByRole('list', { name: 'No order yet' });
    expect(within(loose).getByText('Find papers')).toBeVisible();
    expect(
      within(screen.getByRole('list', { name: 'Steps' })).queryByText('Find papers'),
    ).toBeNull();
  });

  it('continues the selected branch end on Enter when the flow has several', async () => {
    mocks.todos.push(todo('report', { title: 'Report', parent_id: 'hw', sort_order: 30 }));
    mocks.relationships.push(edge('report', 'kernel'));
    mocks.addStep.mockResolvedValue({ todo: todo('new', { parent_id: 'hw' }) });
    renderFlow();

    fireEvent.click(screen.getByRole('button', { name: /^Report/ }));
    const input = screen.getByRole('textbox', { name: 'Next step' });
    fireEvent.change(input, { target: { value: 'Polish' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(mocks.addStep).toHaveBeenCalledWith({
        parentId: 'hw',
        title: 'Polish',
        branchFromId: null,
        afterId: 'report',
      }),
    );
  });

  it('refuses a move that would loop through another task, saying why', () => {
    // Read waits on "Prepare data"; make that outside task wait on Submit.
    mocks.relationships.push(edge('data', 'submit'));
    renderFlow();
    const [read, , submit] = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole(
      'listitem',
    );
    const dataTransfer = { setData: vi.fn(), getData: () => 'submit', effectAllowed: '' };
    fireEvent.dragStart(submit, { dataTransfer });
    fireEvent.drop(read, { dataTransfer });

    expect(mocks.moveStep).not.toHaveBeenCalled();
  });
});
