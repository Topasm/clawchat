import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanProposalResponse, TodoResponse } from '../../../types/api';
import { useToastStore } from '../../../stores/useToastStore';
import TaskFlow, { flowBranchCount } from '../TaskFlow';

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
  createEdge: vi.fn(),
  deleteEdge: vi.fn(),
  applyPlan: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useTodosQuery: () => ({ data: mocks.todos }),
  useTaskRelationshipsQuery: () => ({ data: mocks.relationships }),
  useAddTaskStep: () => ({ mutateAsync: mocks.addStep }),
  useMoveTaskStep: () => ({ mutate: mocks.moveStep }),
  useToggleTodoComplete: () => ({ mutate: mocks.toggle }),
  useCreateTaskRelationship: () => ({ mutateAsync: mocks.createEdge }),
  useDeleteTaskRelationship: () => ({ mutateAsync: mocks.deleteEdge }),
  useApplyPlanProposal: () => ({ mutateAsync: mocks.applyPlan, reset: vi.fn(), error: null }),
  useDismissPlanProposal: () => ({ mutateAsync: vi.fn() }),
  useGeneratePlanProposal: () => ({ mutateAsync: vi.fn() }),
  getPlanProposalMutationError: (error: Error) => ({ message: error.message }),
  isStalePlanProposalError: () => false,
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

function renderFlow(plan?: PlanProposalResponse) {
  return render(
    <MemoryRouter>
      <TaskFlow rootId="hw" plan={plan} />
    </MemoryRouter>,
  );
}

function proposal(): PlanProposalResponse {
  return {
    proposal_id: 'p1',
    status: 'draft',
    summary: 'Three steps',
    base_graph_revision: 4,
    subtasks: [
      { title: 'Benchmark' },
      { title: 'Optimize', depends_on_indices: [0] },
      { title: 'Write up', depends_on_indices: [1] },
    ],
    validation: { errors: [], warnings: [] },
  } as unknown as PlanProposalResponse;
}

describe('TaskFlow', () => {
  beforeEach(() => {
    mocks.addStep.mockReset().mockResolvedValue({});
    mocks.moveStep.mockReset();
    mocks.toggle.mockReset();
    mocks.createEdge.mockReset().mockImplementation(async (body) => ({ id: 'new-edge', ...body }));
    mocks.deleteEdge.mockReset().mockResolvedValue(undefined);
    mocks.applyPlan.mockReset().mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
    mocks.todos = [
      todo('hw', { title: 'GPU homework' }),
      todo('read', { title: 'Read', parent_id: 'hw', sort_order: 0, status: 'completed' }),
      todo('kernel', { title: 'Write kernel', parent_id: 'hw', sort_order: 10 }),
      todo('submit', { title: 'Submit', parent_id: 'hw', sort_order: 20 }),
      todo('tile', { title: 'Tile loops', parent_id: 'kernel', sort_order: 0 }),
      todo('data', { title: 'Prepare data' }),
      todo('lab', { title: 'Lab setup' }),
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
    expect(screen.getByText('Done 1/3')).toBeVisible();
  });

  it('counts a fork only while both of its steps are live', () => {
    mocks.todos.push(todo('figures', { title: 'Figures', parent_id: 'hw', sort_order: 15 }));
    mocks.relationships.push(edge('figures', 'read'));
    const { unmount } = renderFlow();
    expect(document.querySelector('.cc-flow__summary')?.textContent).toBe('Done 1/4 · Branches 1');
    unmount();

    mocks.todos = mocks.todos.map((task) =>
      task.id === 'figures' ? { ...task, status: 'cancelled' } : task,
    );
    renderFlow();
    expect(document.querySelector('.cc-flow__summary')?.textContent).toBe('Done 1/3');
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

  it('waits on another task found from + Prerequisite, and undoes it from the toast', async () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: '+ Prerequisite' }));
    const search = screen.getByRole('textbox', { name: 'Prerequisite' });
    expect(screen.queryByRole('button', { name: 'Prepare data' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'lab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lab setup' }));

    // Read is done, so the flow continues from Write kernel.
    await waitFor(() =>
      expect(mocks.createEdge).toHaveBeenCalledWith({
        source_task_id: 'kernel',
        target_task_id: 'lab',
        type: 'depends_on',
      }),
    );
    const [toast] = useToastStore.getState().toasts;
    expect(toast.message).toBe('Prerequisite added');
    toast.action!.onClick();
    expect(mocks.deleteEdge).toHaveBeenCalledWith('new-edge');
  });

  it('drops an outside prerequisite from its tag, and puts it back on undo', async () => {
    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Prepare data' }));

    await waitFor(() => expect(mocks.deleteEdge).toHaveBeenCalledWith('read-data'));
    const [toast] = useToastStore.getState().toasts;
    expect(toast.message).toBe('Prerequisite removed');
    toast.action!.onClick();
    expect(mocks.createEdge).toHaveBeenCalledWith({
      source_task_id: 'read',
      target_task_id: 'data',
      type: 'depends_on',
    });
  });

  it('draws an AI plan as boxes to retitle or leave out, then adds what is kept', async () => {
    renderFlow(proposal());
    const steps = screen.getByRole('list', { name: 'Steps' });
    const titles = within(steps).getAllByRole('textbox', { name: 'Step title' });
    expect(titles.map((input) => (input as HTMLInputElement).value)).toEqual([
      'Benchmark',
      'Optimize',
      'Write up',
    ]);
    expect(screen.getByRole('button', { name: 'Add all' })).toBeEnabled();

    fireEvent.change(titles[0], { target: { value: 'Benchmark on A100' } });
    // Leaving Optimize out also leaves out Write up, which waits on it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove Optimize' }));
    expect(screen.getByRole('button', { name: 'Restore Write up' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Add 1' }));

    await waitFor(() => expect(mocks.applyPlan).toHaveBeenCalledTimes(1));
    expect(mocks.applyPlan).toHaveBeenCalledWith({
      todoId: 'hw',
      proposalId: 'p1',
      baseGraphRevision: 4,
      selectedIndices: [0],
      subtasks: [
        { title: 'Benchmark on A100' },
        { title: 'Optimize', depends_on_indices: [0] },
        { title: 'Write up', depends_on_indices: [1] },
      ],
    });
  });

  it('keeps Add off while a kept step has no title', () => {
    renderFlow(proposal());
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Step title' })[2], {
      target: { value: ' ' },
    });
    expect(screen.getByRole('button', { name: 'Add all' })).toBeDisabled();
  });
});

describe('flowBranchCount', () => {
  it('counts the extra paths a fork opens', () => {
    const e = (before: string, after: string) => ({ before, after });
    expect(flowBranchCount([e('a', 'b'), e('b', 'c')])).toBe(0);
    expect(
      flowBranchCount([e('read', 'kernel'), e('kernel', 'profile'), e('kernel', 'figures')]),
    ).toBe(1);
    expect(flowBranchCount([e('base', 'A'), e('base', 'B'), e('base', 'H')])).toBe(2);
  });
});
