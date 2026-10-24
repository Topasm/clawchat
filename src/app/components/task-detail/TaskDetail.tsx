import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import DateField from '../shared/DateField';
import StorageLocationBadge from '../shared/StorageLocationBadge';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../../stores/useToastStore';
import useHomeReachable from '../../hooks/useHomeReachable';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { activeWorkspaceName } from '../../utils/workspaceLocation';
import { useDebouncedPersist } from '../../hooks/useDebouncedPersist';
import {
  useTodosQuery,
  useUpdateTodo,
  useDeleteTodo,
  useToggleTodoComplete,
  useLatestPlanProposalQuery,
  useProjectQuery,
  useTaskExecutionTelemetryQuery,
  useRunReadyTaskWithProjectDefaults,
  queryKeys,
} from '../../hooks/queries';
import apiClient from '../../services/apiClient';
import Checkbox from '../shared/Checkbox';
import Badge from '../shared/Badge';
import TaskFlow from '../task-flow/TaskFlow';
import TaskPaths from './TaskPaths';
import TaskMoreMenu, { type TaskMenuItem } from './TaskMoreMenu';
import TaskAgentThreadSection from './TaskAgentThreadSection';
import TaskStageIndicator from '../shared/TaskStageIndicator';
import { getTaskStage } from '../../utils/taskStage';
import { CheckIcon, ChevronLeftIcon } from '../shared/Icons';
import type { TodoResponse, TodoUpdate } from '../../types/api';
import { isTerminalTaskStatus } from '../../utils/taskStatus';
import { formatDate, formatShortDateTime, hasClockTime } from '../../utils/formatters';
import { toDateKey } from '../../utils/calendarUtils';
import { translateUi } from '../../i18n';
import CanonicalDocumentButton from '../shared/CanonicalDocumentButton';
import { extractCanonicalDoc } from '../../utils/canonicalDoc';
import useExperimentCompletionGate from '../../hooks/useExperimentCompletionGate';
import ProjectMachineLine from '../shared/ProjectMachineLine';
import ProjectWorkspaceHosts from '../shared/ProjectWorkspaceHosts';
import Dialog from '../shared/Dialog';
import { useOptionalChatPanelController } from '../chat-panel/ChatPanelControllerContext';
import { useOpenTaskChat } from '../../hooks/useContextChat';
const SKILL_OPTIONS = [
  { id: 'plan', label: 'Plan' },
  { id: 'research', label: 'Research' },
  { id: 'draft', label: 'Draft' },
  { id: 'data_analysis', label: 'Analyze' },
  { id: 'code_review', label: 'Review' },
  { id: 'summarize', label: 'Summarize' },
  { id: 'obsidian_sync', label: 'Sync' },
  { id: 'prioritize', label: 'Prioritize' },
] as const;
const SKILL_LABELS: Record<string, string> = Object.fromEntries(
  SKILL_OPTIONS.map(({ id, label }) => [id, label]),
);
const AGENT_ASSIGNEES = ['planner', 'researcher', 'executor', 'openclaw'];
function getDueCountdown(dueDate: string): {
  label: string;
  variant: 'overdue' | 'today' | 'upcoming';
} {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return {
      label: translateUi('Overdue by {{count}} days', { count: absDays }),
      variant: 'overdue',
    };
  }
  if (diffDays === 0) return { label: translateUi('Due today'), variant: 'today' };
  if (diffDays === 1) return { label: translateUi('Due tomorrow'), variant: 'upcoming' };
  return {
    label: translateUi('{{count}} days left', { count: diffDays }),
    variant: 'upcoming',
  };
}
interface TaskDetailProps {
  taskId: string;
  /** Where a step or parent opens; the task page by default. */
  onOpenTask?: (taskId: string) => void;
  /** Called once the task is gone (deleted or missing); the task list by default. */
  onDeleted?: () => void;
  /** Where the ⋮ menu renders when a host's header owns it (the pane). */
  menuSlot?: HTMLElement | null;
  /** The host's own entries, listed before the task's. */
  extraMenuItems?: TaskMenuItem[];
  /** Draws ← at the start of the title row; the page passes it, the pane has its own close. */
  onBack?: () => void;
}
/**
 * A task's detail: the body of the task page, and of the desktop pane that
 * opens beside a list. It reads no route, so both can host it.
 */
export default function TaskDetail({
  taskId,
  onOpenTask,
  onDeleted,
  menuSlot,
  extraMenuItems,
  onBack,
}: TaskDetailProps) {
  const navigate = useNavigate();
  const homeReachable = useHomeReachable();
  const workspaceName = useWorkspaceStore(activeWorkspaceName);
  const openTask = useCallback(
    (id: string) => (onOpenTask ? onOpenTask(id) : navigate(`/tasks/${id}`)),
    [navigate, onOpenTask],
  );
  const leave = useCallback(
    () => (onDeleted ? onDeleted() : navigate('/tasks')),
    [navigate, onDeleted],
  );
  const queryClient = useQueryClient();
  const { data: todos = [] } = useTodosQuery();
  const updateTodoMutation = useUpdateTodo();
  const deleteTodoMutation = useDeleteTodo();
  const toggleCompleteMutation = useToggleTodoComplete();
  const { requestStatusChange, confirmationDialog } = useExperimentCompletionGate();
  const task = todos.find((t) => t.id === taskId);
  const {
    data: project,
    isLoading: projectLoading,
    isError: projectError,
  } = useProjectQuery(task?.project_id ?? undefined);
  // Where the task runs is a project setting; it opens in the same dialog as
  // on the project page instead of unfolding in the middle of this one.
  const [hostsOpen, setHostsOpen] = useState(false);
  const latestPlanQuery = useLatestPlanProposalQuery(taskId, Boolean(task));
  const openTaskChat = useOpenTaskChat(useOptionalChatPanelController());
  const { data: telemetry = [] } = useTaskExecutionTelemetryQuery();
  const runner = useRunReadyTaskWithProjectDefaults(Boolean(task?.assignee));
  const childTasks = todos.filter((t) => t.parent_id === taskId);
  const parentTask = task?.parent_id ? todos.find((t) => t.id === task.parent_id) : null;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const plan = latestPlanQuery.data ?? null;
  useEffect(() => {
    setHostsOpen(false);
  }, [taskId]);
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
    }
  }, [task]);
  const serverUpdateTodo = useCallback(
    (id: string, data: TodoUpdate) => {
      updateTodoMutation.mutate({ id, data });
    },
    [updateTodoMutation],
  );
  const localUpdateTodo = useCallback(
    (id: string, updates: TodoUpdate) => {
      // Optimistic local update in the query cache
      queryClient.setQueryData<TodoResponse[]>(queryKeys.todos, (old) =>
        (old ?? []).map((t) => (t.id === id ? ({ ...t, ...updates } as TodoResponse) : t)),
      );
    },
    [queryClient],
  );
  const persistField = useDebouncedPersist<TodoUpdate>(taskId, serverUpdateTodo, localUpdateTodo);
  const handleTitleChange = (val: string) => {
    setTitle(val);
    persistField({ title: val });
  };
  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    persistField({ description: val });
  };
  const handleDelete = async () => {
    if (!taskId) return;
    deleteTodoMutation.mutate(taskId);
    leave();
  };
  const handleToggle = useCallback(
    (id: string) => {
      const todo = todos.find((t) => t.id === id);
      if (todo) {
        const nextStatus = todo.status === 'completed' ? 'pending' : 'completed';
        requestStatusChange(todo, nextStatus, () =>
          toggleCompleteMutation.mutate({ id, currentStatus: todo.status }),
        );
      }
    },
    [requestStatusChange, todos, toggleCompleteMutation],
  );
  if (!task) {
    return (
      <div className="cc-detail">
        <div className="cc-page-header__subtitle">{translateUi('Task not found')}</div>
        <button type="button" className="cc-btn cc-btn--secondary cc-mt-16" onClick={leave}>
          {translateUi('\n          Back to tasks\n        ')}
        </button>
      </div>
    );
  }
  const isProject = task.source === 'obsidian_project';
  const hasPlan = plan && (plan.status === 'draft' || plan.status === 'stale');
  const isPlanned = childTasks.length > 0;
  const dueInfo =
    task.due_date && !isTerminalTaskStatus(task.status) ? getDueCountdown(task.due_date) : null;
  const canonicalDoc = extractCanonicalDoc(project?.description);
  const taskTelemetry = telemetry.find((item) => item.task_id === task.id);
  const stage = getTaskStage({
    taskStatus: task.status,
    inboxState: task.inbox_state,
    planStatus: plan?.status,
    runStatus: taskTelemetry?.latest_run_status,
    pendingReviewCount: taskTelemetry?.pending_review_count,
    hasSubtasks: isPlanned,
  });
  const hasAgentSkills = Boolean(
    task.enabled_skills?.length || (task.assignee && AGENT_ASSIGNEES.includes(task.assignee)),
  );
  // A task is yours unless it was handed to AI (assignee) or AI already ran
  // it. Only delegated work shows the five steps and the plan button; for
  // your own task the top of the page is its due date and flow.
  const isDelegated = Boolean(
    task.assignee ||
    hasAgentSkills ||
    taskTelemetry?.latest_run_status ||
    taskTelemetry?.pending_review_count,
  );
  const planIsNext = isDelegated && stage.stage === 'capture' && !stage.exception;
  // Suggesting steps starts AI planning on Home, so it waits like a hand-off.
  const organize = async () => {
    if (!homeReachable) {
      useToastStore.getState().addToast(
        'info',
        translateUi('Reconnect to {{workspace}} to hand this to AI', {
          workspace: workspaceName,
        }),
      );
      return;
    }
    try {
      await apiClient.post(`/todos/${taskId}/organize`);
      useToastStore.getState().addToast('info', translateUi('Planning...'));
    } catch {
      useToastStore.getState().addToast('error', translateUi('Failed'));
    }
  };
  // The task's conversation opens in the one AI panel, as ⌘K does here.
  const discuss = () => openTaskChat(task.id);
  const setAssignee = (assignee: string | null) => {
    // A hand-off needs Home: the run would start there. Checking and adding
    // keep working offline; delegating waits for the connection.
    if (assignee && !homeReachable) {
      useToastStore.getState().addToast(
        'info',
        translateUi('Reconnect to {{workspace}} to hand this to AI', {
          workspace: workspaceName,
        }),
      );
      return;
    }
    const previous = task.assignee ?? null;
    updateTodoMutation.mutate({ id: task.id, data: { assignee } });
    const undo = {
      label: translateUi('Undo'),
      onClick: () => updateTodoMutation.mutate({ id: task.id, data: { assignee: previous } }),
    };
    // Handing work over says where it will run, and that place can be changed
    // right there; Undo stays as the second choice.
    const host = assignee ? project?.execution_host_label : null;
    useToastStore.getState().addToast(
      'success',
      host
        ? translateUi('Delegated to AI · Runs on {{host}}', { host })
        : translateUi(assignee ? 'Delegated to AI' : 'Back to you'),
      host
        ? {
            duration: 6000,
            action: { label: translateUi('Change'), onClick: () => setHostsOpen(true) },
            secondaryAction: undo,
          }
        : { duration: 5000, action: undo },
    );
  };
  const canPlan = !hasPlan && !isTerminalTaskStatus(task.status);
  // Delegated, with no plan waiting to be checked and nothing in the way: the
  // next step is to start it as it stands. Suggesting steps first stays beside.
  const canStartAsIs =
    isDelegated &&
    Boolean(task.assignee) &&
    !hasPlan &&
    !isPlanned &&
    !taskTelemetry?.latest_run_status &&
    !isTerminalTaskStatus(task.status) &&
    !task.open_prerequisites?.length &&
    runner.canRunTask(task.id);
  const menuItems: TaskMenuItem[] = [
    { label: translateUi('Discuss with agent'), onSelect: () => void discuss() },
    ...(canPlan && !planIsNext
      ? [{ label: translateUi('Suggest steps'), onSelect: () => void organize() }]
      : []),
    task.assignee
      ? { label: translateUi('Do it myself'), onSelect: () => setAssignee(null) }
      : { label: translateUi('Delegate'), onSelect: () => setAssignee('agent') },
    ...(project
      ? [{ label: translateUi('Where this runs'), onSelect: () => setHostsOpen(true) }]
      : []),
    { label: translateUi('Delete Task'), onSelect: () => void handleDelete(), danger: true },
  ];
  const menu = <TaskMoreMenu items={[...(extraMenuItems ?? []), ...menuItems]} />;
  return (
    <div className="cc-detail cc-exec-panel">
      <div className="cc-exec-panel__top">
        <div className="cc-exec-panel__top-row">
          {onBack && (
            <button
              type="button"
              className="cc-icon-button cc-exec-panel__back"
              aria-label={translateUi('Back')}
              title={translateUi('Back')}
              onClick={onBack}
            >
              <ChevronLeftIcon size={18} />
            </button>
          )}
          <Checkbox checked={task.status === 'completed'} onChange={() => handleToggle(task.id)} />
          <input
            className="cc-detail__title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={translateUi('Task title')}
          />
          {/* Where a delegated task is, small at the end of the title row; a
              task of your own has no run, plan or review to be between. */}
          {isDelegated && <TaskStageIndicator state={stage} />}
          {menuSlot ? createPortal(menu, menuSlot) : menu}
        </div>
        <div className="cc-exec-panel__meta-line">
          <span
            className={`cc-exec-panel__due-editor${dueInfo ? ` cc-exec-panel__info-item--${dueInfo.variant}` : ''}`}
          >
            <DateField
              className="cc-exec-panel__due-input"
              aria-label={translateUi('Due')}
              placeholder={translateUi('Due')}
              value={task.due_date ? toDateKey(new Date(task.due_date)) : ''}
              onChange={(val) => {
                if (!val) {
                  persistField({ due_date: null });
                  return;
                }
                // Moving the day keeps a clock time the task already has.
                const [y, m, d] = val.split('-').map(Number);
                const next = task.due_date ? new Date(task.due_date) : new Date();
                if (!task.due_date || !hasClockTime(task.due_date)) next.setHours(23, 59, 0, 0);
                next.setFullYear(y, m - 1, d);
                persistField({ due_date: next.toISOString() });
              }}
            />
            {task.due_date && (
              <button
                type="button"
                className="cc-exec-panel__due-clear"
                onClick={() => persistField({ due_date: null })}
                aria-label={translateUi('Clear due date')}
              >
                ×
              </button>
            )}
            {dueInfo && task.due_date && (
              <span className="cc-exec-panel__info-value cc-exec-panel__due-line">
                {hasClockTime(task.due_date)
                  ? formatShortDateTime(task.due_date)
                  : formatDate(task.due_date)}{' '}
                · {dueInfo.label}
              </span>
            )}
          </span>
          {project && !projectError && (
            <Link className="cc-exec-panel__context-link" to={`/projects/${project.id}`}>
              {project.title}
            </Link>
          )}
          {projectError && (
            <span role="alert">{translateUi('This project could not be loaded.')}</span>
          )}
          {parentTask && (
            <Link
              className="cc-exec-panel__context-link"
              to={`/tasks/${parentTask.id}`}
              onClick={(event) => {
                // In the pane the parent takes the task's place; the page keeps its link.
                if (onOpenTask) {
                  event.preventDefault();
                  onOpenTask(parentTask.id);
                }
              }}
            >
              ↑ {parentTask.title}
            </Link>
          )}
          {isProject && (
            <span className="cc-exec-panel__context-badge cc-exec-panel__context-badge--synced">
              <CheckIcon size={12} />
              {translateUi('Obsidian project')}
            </span>
          )}
          <CanonicalDocumentButton target={canonicalDoc} />
          <StorageLocationBadge item={task} variant="line" />
        </div>
      </div>

      {isDelegated && (
        <div className="cc-exec-panel__section cc-exec-panel__agent">
          {(canStartAsIs || (planIsNext && canPlan && !isPlanned)) && (
            <div className="cc-exec-panel__agent-actions">
              {canStartAsIs && (
                <button
                  type="button"
                  className="cc-btn cc-btn--primary"
                  disabled={runner.isPending || !homeReachable}
                  title={
                    homeReachable
                      ? undefined
                      : translateUi('Reconnect to {{workspace}} to hand this to AI', {
                          workspace: workspaceName,
                        })
                  }
                  onClick={() => void runner.runTask(task.id)}
                >
                  {translateUi('Start as is')}
                </button>
              )}
              {planIsNext && canPlan && !isPlanned && (
                <button
                  type="button"
                  className={`cc-btn ${canStartAsIs ? 'cc-btn--ghost' : 'cc-btn--primary'}`}
                  onClick={() => void organize()}
                >
                  {translateUi('Suggest steps')}
                </button>
              )}
            </div>
          )}
          {hasAgentSkills && (
            <div className="cc-exec-panel__agent-status">
              <span className="cc-exec-panel__agent-badge">
                {task.enabled_skills?.length
                  ? task.enabled_skills.map((s) => translateUi(SKILL_LABELS[s] || s)).join(' → ')
                  : task.assignee === 'openclaw'
                    ? translateUi('OpenClaw AI')
                    : task.assignee}
              </span>
              <span className="cc-exec-panel__agent-state">
                {task.inbox_state === 'planning'
                  ? translateUi('Planning in progress')
                  : task.inbox_state === 'classifying'
                    ? translateUi('Classifying...')
                    : task.inbox_state === 'plan_ready'
                      ? translateUi('Plan ready for review')
                      : translateUi('Assigned · start from Inbox when Ready')}
              </span>
            </div>
          )}
          {project && !projectError && (
            <ProjectMachineLine project={project} onChange={() => setHostsOpen(true)} />
          )}
        </div>
      )}
      {projectLoading && <p className="cc-exec-panel__hint">{translateUi('Loading project…')}</p>}

      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">{translateUi('Flow')}</div>
        <TaskFlow rootId={task.id} plan={hasPlan ? plan : null} onOpenTask={openTask} />
      </div>

      <TaskPaths taskId={task.id} />

      <div className="cc-exec-panel__section">
        <textarea
          className="cc-detail__textarea"
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          placeholder={translateUi('Add a description...')}
          aria-label={translateUi('Description')}
        />
      </div>

      <TaskAgentThreadSection taskId={task.id} />

      {task.tags && task.tags.length > 0 && (
        <details className="cc-exec-panel__more">
          <summary>
            {translateUi('More')}
            {` · ${translateUi('Tags')} ${task.tags.length}`}
          </summary>
          <div className="cc-exec-panel__tags">
            {task.tags.map((tag) => (
              <Badge key={tag} variant="tag">
                {tag}
              </Badge>
            ))}
          </div>
        </details>
      )}

      {project && (
        <Dialog
          open={hostsOpen}
          onOpenChange={setHostsOpen}
          title={translateUi('Where this runs')}
          className="cc-dialog__content--wide cc-project-settings-dialog"
        >
          <ProjectWorkspaceHosts key={project.id} projectId={project.id} />
        </Dialog>
      )}
      {confirmationDialog}
    </div>
  );
}
