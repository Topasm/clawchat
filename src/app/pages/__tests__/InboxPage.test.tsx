import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from '../../stores/useToastStore';
import type {
  InboxTriagePreviewResponse,
  ProjectResponse,
  TaskDependencyPreviewResponse,
  TaskGraphInsightsResponse,
  TodoResponse,
} from '../../types/api';
import InboxPage from '../InboxPage';

const mocks = vi.hoisted(() => ({
  todos: [] as unknown[],
  projects: [] as unknown[],
  telemetry: [] as unknown[],
  graphInsights: { data: undefined as unknown, refetch: vi.fn() },
  isMobile: false,
  placeTodo: vi.fn(),
  placeBatch: vi.fn(),
  placeGroups: vi.fn(),
  previewTriage: vi.fn(),
  undoPlacement: vi.fn(),
  previewDependency: vi.fn(),
  createDependency: vi.fn(),
  toggleTodo: vi.fn(),
  deleteTodo: vi.fn(),
  startExecution: vi.fn(),
  invalidateQueries: vi.fn(),
  post: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('../../hooks/queries', () => ({
  queryKeys: { todos: ['todos'] },
  useTodosQuery: () => ({ data: mocks.todos }),
  useProjectsQuery: () => ({ data: mocks.projects }),
  useTaskGraphInsightsQuery: () => mocks.graphInsights,
  useTaskExecutionTelemetryQuery: () => ({ data: mocks.telemetry }),
  useTaskRelationshipsQuery: () => ({ data: [] }),
  useSkillsQuery: () => ({ data: { skills: [] } }),
  useExecutionProvidersQuery: () => ({ data: [] }),
  useStartReadyTaskExecution: () => ({ mutateAsync: mocks.startExecution, isPending: false }),
  useToggleTodoComplete: () => ({ mutate: mocks.toggleTodo }),
  useDeleteTodo: () => ({ mutate: mocks.deleteTodo }),
  usePlaceTodo: () => ({ mutateAsync: mocks.placeTodo, isPending: false }),
  usePlaceTodosBatch: () => ({ mutateAsync: mocks.placeBatch, isPending: false }),
  usePlaceTodoGroups: () => ({ mutateAsync: mocks.placeGroups, isPending: false }),
  usePreviewInboxTriage: () => ({ mutateAsync: mocks.previewTriage, isPending: false }),
  useUndoTodoPlacement: () => ({ mutateAsync: mocks.undoPlacement, isPending: false }),
  usePreviewTaskDependency: () => ({ mutateAsync: mocks.previewDependency, isPending: false }),
  useCreateTaskDependency: () => ({ mutateAsync: mocks.createDependency, isPending: false }),
}));

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { ...actual, useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) };
});

vi.mock('../../services/apiClient', () => ({
  default: { post: (...args: unknown[]) => mocks.post(...args) },
}));

vi.mock('../../hooks/usePlatform', () => ({
  default: () => ({
    platform: 'web',
    isMobile: mocks.isMobile,
    isDesktop: !mocks.isMobile,
    isWeb: true,
    isTauri: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

const TIMESTAMPS = { created_at: '2026-08-27T00:00:00Z', updated_at: '2026-08-27T00:00:00Z' };

function todo(overrides: Partial<TodoResponse> & Pick<TodoResponse, 'id' | 'title'>): TodoResponse {
  return {
    status: 'pending',
    sort_order: 0,
    inbox_state: 'none',
    ...TIMESTAMPS,
    ...overrides,
  } as TodoResponse;
}

const project: ProjectResponse = {
  id: 'project-1',
  title: 'Paper',
  status: 'active',
  graph_revision: 7,
  root_task_id: 'root-1',
  execution_workspace_isolation: 'local',
  ...TIMESTAMPS,
  task_count: 1,
  completed_task_count: 0,
} as ProjectResponse;

const captured1 = todo({ id: 'captured-1', title: 'Draft outline', inbox_state: 'captured' });
const captured2 = todo({ id: 'captured-2', title: 'Collect references', inbox_state: 'captured' });
const planning = todo({ id: 'planning-1', title: 'Thinking task', inbox_state: 'planning' });
const questioning = todo({
  id: 'questioning-1',
  title: 'Ambiguous task',
  inbox_state: 'questioning',
  clarification_questions: ['What is the scope?'],
});
const planReady = todo({ id: 'ready-1', title: 'Planned task', inbox_state: 'plan_ready' });
const failed = todo({ id: 'error-1', title: 'Broken task', inbox_state: 'error' });
const finished = todo({
  id: 'done-1',
  title: 'Finished task',
  inbox_state: 'captured',
  status: 'completed',
});
const placed = todo({
  id: 'placed-1',
  title: 'Figures',
  project_id: project.id,
  parent_id: project.root_task_id,
});

const graphInsights = {
  graph_revision: 7,
  generated_at: '2026-08-27T00:00:00Z',
  scope: {
    root_task_id: null,
    task_count: 2,
    primary_task_count: 2,
    relationship_count: 0,
    prerequisite_task_count: 0,
  },
  nodes: [
    {
      task_id: captured1.id,
      title: captured1.title,
      status: 'pending',
      parent_id: null,
      scope_role: 'global',
      execution_state: 'ready',
      estimated_minutes: 30,
      due_date: null,
      dependency_ids: [],
      direct_blocker_ids: [],
      transitive_blocker_ids: [],
      transitive_blocker_count: 0,
      transitive_blockers_truncated: false,
      downstream_task_ids: [],
      downstream_count: 0,
      downstream_truncated: false,
      is_ready: true,
      is_blocked: false,
      is_unschedulable: false,
      is_on_critical_path: false,
      remaining_path_minutes: 30,
      remaining_path_known_minutes: 30,
      estimate_complete: true,
      is_container: false,
      due_slack_minutes: null,
      due_risk: 'none',
    },
  ],
  summary: {
    ready_count: 2,
    blocked_count: 1,
    critical_path_minutes: 45,
  },
  issues: [],
  issues_truncated: false,
} as unknown as TaskGraphInsightsResponse;

function dataTransfer() {
  const store = new Map<string, string>();
  return {
    effectAllowed: '',
    dropEffect: '',
    get types() {
      return Array.from(store.keys());
    },
    setData(type: string, value: string) {
      store.set(type, value);
    },
    getData(type: string) {
      return store.get(type) ?? '';
    },
  };
}

function renderInbox() {
  return render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>,
  );
}

function cardFor(title: string): HTMLElement {
  const card = screen.getAllByText(title)[0].closest('.cc-inbox-card');
  if (!card) throw new Error(`No inbox card for ${title}`);
  return card as HTMLElement;
}

let addToast: ReturnType<typeof vi.fn>;

describe('InboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isMobile = false;
    mocks.projects = [project];
    mocks.telemetry = [];
    mocks.todos = [
      captured1,
      captured2,
      planning,
      questioning,
      planReady,
      failed,
      finished,
      placed,
    ];
    mocks.graphInsights = { data: graphInsights, refetch: vi.fn() };
    mocks.post.mockResolvedValue({ data: {} });
    addToast = vi.fn(() => 'toast-1');
    useToastStore.setState({ addToast: addToast as never });
  });

  it('buckets open inbox items by inbox state and ignores terminal tasks', () => {
    renderInbox();

    expect(screen.getByText('6 items')).toBeInTheDocument();
    expect(screen.getByText('Planning now')).toBeInTheDocument();
    expect(screen.getByText('Answer questions')).toBeInTheDocument();
    expect(screen.getByText('Review suggestion')).toBeInTheDocument();
    expect(screen.getByText('Needs organizing')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing is open', () => {
    mocks.todos = [finished, placed];
    renderInbox();

    expect(
      screen.getByText('Inbox is clear. Capture a task or note when something comes up.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Capture first, organise later')).toBeInTheDocument();
  });

  it('keeps the batch bar in sync with batch selection', () => {
    renderInbox();

    expect(screen.getByText('Select tasks to move them together')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select Draft outline for batch placement'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Select tasks to move them together')).toBeInTheDocument();
  });

  it('unplaces a dragged task onto the Inbox drop target', async () => {
    mocks.placeTodo.mockResolvedValue({
      graph_revision: 8,
      change_set_id: 'change-1',
      insights_delta: { ready_count: 1, blocked_count: -1, critical_path_minutes: null },
    });
    renderInbox();

    const transfer = dataTransfer();
    fireEvent.dragStart(cardFor('Draft outline'), { dataTransfer: transfer });
    expect(transfer.getData('application/x-clawchat-task-id')).toBe('captured-1');

    fireEvent.drop(screen.getByText('Inbox · drop here to unplace'), { dataTransfer: transfer });

    await waitFor(() =>
      expect(mocks.placeTodo).toHaveBeenCalledWith({
        id: 'captured-1',
        placement: {
          project_id: null,
          parent_id: null,
          before_id: null,
          inbox_state: 'captured',
          expected_graph_revision: 7,
        },
      }),
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        'success',
        'Moved “Draft outline” · Ready +1 · Blocked -1',
        expect.objectContaining({ duration: 6000 }),
      ),
    );
  });

  it('offers an undo action that reverts the placement change set', async () => {
    mocks.placeTodo.mockResolvedValue({
      graph_revision: 8,
      change_set_id: 'change-1',
      insights_delta: null,
    });
    mocks.undoPlacement.mockResolvedValue({ graph_revision: 7 });
    renderInbox();

    const transfer = dataTransfer();
    fireEvent.dragStart(cardFor('Draft outline'), { dataTransfer: transfer });
    fireEvent.drop(screen.getByText('Inbox · drop here to unplace'), { dataTransfer: transfer });

    await waitFor(() => expect(addToast).toHaveBeenCalled());
    const options = addToast.mock.calls.at(-1)?.[2] as { action: { onClick: () => void } };
    options.action.onClick();

    await waitFor(() => expect(mocks.undoPlacement).toHaveBeenCalledWith('change-1'));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith('info', 'Placement reverted'));
  });

  it('drags a multi-task batch as one atomic placement', async () => {
    mocks.placeBatch.mockResolvedValue({
      graph_revision: 9,
      change_set_id: 'change-2',
      insights_delta: null,
    });
    renderInbox();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));

    const transfer = dataTransfer();
    fireEvent.dragStart(cardFor('Draft outline'), { dataTransfer: transfer });
    expect(transfer.getData('application/x-clawchat-task-batch')).toBe(
      JSON.stringify(['captured-1', 'captured-2']),
    );

    fireEvent.drop(screen.getByText('Inbox · drop here to unplace'), { dataTransfer: transfer });

    await waitFor(() =>
      expect(mocks.placeBatch).toHaveBeenCalledWith({
        todo_ids: ['captured-1', 'captured-2'],
        project_id: null,
        parent_id: null,
        before_id: null,
        inbox_state: 'captured',
        expected_graph_revision: 7,
      }),
    );
    expect(mocks.placeTodo).not.toHaveBeenCalled();
  });

  it('starts a dependency drag from the prerequisite handle', () => {
    renderInbox();

    const transfer = dataTransfer();
    fireEvent.dragStart(
      screen.getByLabelText('Drag Draft outline to a task that must finish first'),
      { dataTransfer: transfer },
    );

    expect(transfer.getData('application/x-clawchat-task-dependency')).toBe('captured-1');
  });

  it('previews and confirms a dependency chosen from the inspector', async () => {
    const preview: TaskDependencyPreviewResponse = {
      dependent_task_id: 'captured-1',
      prerequisite_task_id: 'captured-2',
      base_graph_revision: 7,
      affected_task_ids: ['captured-1'],
      insights_delta: { ready_count: -1, blocked_count: 1, critical_path_minutes: 10 },
    };
    mocks.previewDependency.mockResolvedValue(preview);
    mocks.createDependency.mockResolvedValue({ ...preview, graph_revision: 8 });
    renderInbox();

    fireEvent.click(screen.getByLabelText('Select Draft outline for placement'));
    fireEvent.change(screen.getByLabelText('Must wait for'), { target: { value: 'captured-2' } });

    await waitFor(() =>
      expect(mocks.previewDependency).toHaveBeenCalledWith({
        dependent_task_id: 'captured-1',
        prerequisite_task_id: 'captured-2',
        expected_graph_revision: 7,
      }),
    );

    const panel = await screen.findByLabelText('Dependency impact preview');
    expect(within(panel).getByText('1 affected tasks')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(mocks.createDependency).toHaveBeenCalledWith({
        dependent_task_id: 'captured-1',
        prerequisite_task_id: 'captured-2',
        expected_graph_revision: 7,
      }),
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        'success',
        '“Draft outline” now waits for “Collect references”',
      ),
    );
  });

  it('excludes project roots and the selected task from the prerequisite options', () => {
    renderInbox();

    fireEvent.click(screen.getByLabelText('Select Draft outline for placement'));
    const select = screen.getByLabelText('Must wait for');
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);

    expect(options).toEqual([
      'Choose a prerequisite…',
      'Ambiguous task',
      'Broken task',
      'Collect references',
      'Finished task',
      'Planned task',
      'Thinking task',
      'Figures',
    ]);
  });

  it('previews AI triage and applies the selected suggestions as placement groups', async () => {
    const preview: InboxTriagePreviewResponse = {
      base_graph_revision: 7,
      suggestions: [
        {
          task_id: 'captured-1',
          project_id: project.id,
          parent_id: null,
          proposed_parent_key: 'ws-1',
          confidence: 0.8,
          reason: 'Matches the figures workstream',
        },
        {
          task_id: 'captured-2',
          project_id: project.id,
          parent_id: 'placed-1',
          confidence: 0.6,
          reason: 'Belongs under figures',
        },
      ],
      proposed_workstreams: [
        {
          key: 'ws-1',
          project_id: project.id,
          parent_id: null,
          title: 'Outline',
          confidence: 0.9,
          reason: 'Groups the outline work',
        },
      ],
      unassigned_task_ids: ['captured-3'],
      model_provider: 'ollama',
    };
    mocks.previewTriage.mockResolvedValue(preview);
    mocks.placeGroups.mockResolvedValue({
      graph_revision: 10,
      change_set_id: 'change-3',
    });
    renderInbox();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI suggest' }));

    await waitFor(() =>
      expect(mocks.previewTriage).toHaveBeenCalledWith({
        todo_ids: ['captured-1', 'captured-2'],
        expected_graph_revision: 7,
      }),
    );

    expect(await screen.findByText('AI placement preview')).toBeInTheDocument();
    expect(screen.getByText('2 suggested · 1 new Workstream · ollama')).toBeInTheDocument();
    expect(screen.getByLabelText('Proposed Workstream Outline')).toBeInTheDocument();
    expect(screen.getByText('No confident location: 1 task')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply selected (2)' }));

    await waitFor(() =>
      expect(mocks.placeGroups).toHaveBeenCalledWith({
        groups: [
          {
            todo_ids: ['captured-1'],
            project_id: project.id,
            parent_id: null,
            inbox_state: 'none',
            create_parent: { title: 'Outline', description: undefined, parent_id: null },
          },
          {
            todo_ids: ['captured-2'],
            project_id: project.id,
            parent_id: 'placed-1',
            inbox_state: 'none',
          },
        ],
        expected_graph_revision: 7,
      }),
    );
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        'success',
        'Applied 2 AI placement suggestions',
        expect.objectContaining({ duration: 6000 }),
      ),
    );
  });

  it('drops the AI preview when the graph revision moves on', async () => {
    mocks.previewTriage.mockResolvedValue({
      base_graph_revision: 7,
      suggestions: [],
      proposed_workstreams: [],
      unassigned_task_ids: [],
      model_provider: null,
    });
    const { rerender } = renderInbox();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    fireEvent.click(screen.getByRole('button', { name: 'AI suggest' }));
    expect(await screen.findByText('AI placement preview')).toBeInTheDocument();

    mocks.graphInsights = {
      data: { ...graphInsights, graph_revision: 11 },
      refetch: vi.fn(),
    };
    rerender(
      <MemoryRouter>
        <InboxPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByText('AI placement preview')).not.toBeInTheDocument());
  });

  it('submits questionnaire answers and refreshes the todo list', async () => {
    renderInbox();

    fireEvent.change(screen.getByPlaceholderText('Your answer...'), {
      target: { value: 'Just the intro' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Answers' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/todos/questioning-1/answer-questions', {
        answers: { '0': 'Just the intro' },
      }),
    );
    expect(addToast).toHaveBeenCalledWith('info', 'Planning with your answers...');
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['todos'] });
  });

  it('skips the questionnaire when asked', async () => {
    renderInbox();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/todos/questioning-1/skip-questions'),
    );
    expect(addToast).toHaveBeenCalledWith('info', 'Skipping questions, planning...');
  });

  it('organizes a captured task and retries a failed one', async () => {
    renderInbox();

    fireEvent.click(within(cardFor('Draft outline')).getByRole('button', { name: 'Organize' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/todos/captured-1/organize'));
    expect(addToast).toHaveBeenCalledWith('info', 'Organizing...');

    fireEvent.click(screen.getByRole('button', { name: /Failed/ }));
    fireEvent.click(within(cardFor('Broken task')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/todos/error-1/organize'));
    expect(addToast).toHaveBeenCalledWith('info', 'Retrying...');
  });

  it('renders the inspector for the selected task with graph impact', () => {
    renderInbox();

    fireEvent.click(screen.getByLabelText('Select Draft outline for placement'));

    const inspector = screen.getByLabelText('Selected task');
    expect(within(inspector).getByRole('heading', { name: 'Draft outline' })).toBeInTheDocument();
    expect(within(inspector).getByText('Inbox')).toBeInTheDocument();
    expect(within(inspector).getByText('pending')).toBeInTheDocument();
    expect(within(inspector).getByText('ready')).toBeInTheDocument();
    expect(
      within(inspector).getByText('Ready 2 · Blocked 1 · Critical path 45m'),
    ).toBeInTheDocument();
    expect(within(inspector).getByLabelText('Start agent execution')).toBeInTheDocument();
  });

  it('prompts for a selection when no task is chosen', () => {
    renderInbox();

    expect(
      within(screen.getByLabelText('Selected task')).getByText(
        'Select or drag an Inbox card to organize it.',
      ),
    ).toBeInTheDocument();
  });

  it('renders execution telemetry actions for the selected task', () => {
    mocks.telemetry = [
      {
        task_id: 'captured-1',
        latest_run_id: 'run-1',
        latest_run_status: 'completed',
        latest_run_progress: 100,
        latest_run_provider: 'builtin',
        latest_run_progress_message: 'Finished the draft',
        latest_run_updated_at: '2026-08-27T00:00:00Z',
        human_wait_seconds: 180,
        question_count: 2,
        average_resume_seconds: 90,
        pending_review_count: 1,
        artifact_count: 2,
        latest_artifact_id: 'artifact-1',
        latest_artifact_title: 'Outline draft',
        latest_artifact_type: 'report',
        latest_artifact_updated_at: '2026-08-27T00:00:00Z',
      },
    ];
    renderInbox();

    fireEvent.click(screen.getByLabelText('Select Draft outline for placement'));

    const telemetry = screen.getByLabelText('Task execution activity');
    expect(within(telemetry).getByText('Finished the draft')).toBeInTheDocument();
    expect(within(telemetry).getByText('Latest artifact: Outline draft')).toBeInTheDocument();
    expect(within(telemetry).getByText('Waiting on people: 3m')).toBeInTheDocument();
    expect(within(telemetry).getByText('Questions: 2')).toBeInTheDocument();
    expect(within(telemetry).getByText('Average time to resume: 2m')).toBeInTheDocument();

    fireEvent.click(within(telemetry).getByRole('button', { name: 'Open run' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/runs?run_id=run-1');

    fireEvent.click(within(telemetry).getByRole('button', { name: 'Review' }));
    expect(mocks.navigate).toHaveBeenCalledWith('/review');
  });

  it('returns a placed task to the Inbox from the inspector', async () => {
    mocks.placeTodo.mockResolvedValue({
      graph_revision: 8,
      change_set_id: 'change-4',
      insights_delta: null,
    });
    renderInbox();

    const transfer = dataTransfer();
    fireEvent.dragStart(
      screen.getByLabelText('Drag Draft outline to a task that must finish first'),
      { dataTransfer: transfer },
    );
    fireEvent.click(screen.getByLabelText('Select Draft outline for placement'));
    expect(screen.queryByRole('button', { name: 'Return to Inbox' })).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Figures')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Return to Inbox' }));

    await waitFor(() =>
      expect(mocks.placeTodo).toHaveBeenCalledWith({
        id: 'placed-1',
        placement: {
          project_id: null,
          parent_id: null,
          before_id: null,
          inbox_state: 'captured',
          expected_graph_revision: 7,
        },
      }),
    );
  });

  it('moves the project tree into the inspector on mobile and hides quick capture', () => {
    mocks.isMobile = true;
    renderInbox();

    expect(screen.queryByRole('button', { name: '+ New' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Draft outline for placement'));
    expect(screen.getByText('Move to project tree')).toBeInTheDocument();
  });

  it('warns instead of placing while the graph revision is still loading', () => {
    mocks.graphInsights = { data: undefined, refetch: vi.fn() };
    renderInbox();

    const transfer = dataTransfer();
    fireEvent.dragStart(cardFor('Draft outline'), { dataTransfer: transfer });
    fireEvent.drop(screen.getByText('Inbox · drop here to unplace'), { dataTransfer: transfer });

    expect(mocks.placeTodo).toHaveBeenCalledTimes(0);
    expect(addToast).toHaveBeenCalledWith('warning', 'The current graph revision is still loading');
  });
});
