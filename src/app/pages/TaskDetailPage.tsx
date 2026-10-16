import { useState, useEffect, useCallback } from 'react';
import StorageLocationBadge from '../components/shared/StorageLocationBadge';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../stores/useToastStore';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import {
  useTodosQuery,
  useUpdateTodo,
  useDeleteTodo,
  useToggleTodoComplete,
  useLatestPlanProposalQuery,
  useProjectQuery,
  useTaskExecutionTelemetryQuery,
  queryKeys,
} from '../hooks/queries';
import apiClient from '../services/apiClient';
import Checkbox from '../components/shared/Checkbox';
import Badge from '../components/shared/Badge';
import TaskFlow from '../components/task-flow/TaskFlow';
import TaskPaths from '../components/task-detail/TaskPaths';
import TaskMoreMenu, { type TaskMenuItem } from '../components/task-detail/TaskMoreMenu';
import FileDropZone from '../components/shared/FileDropZone';
import AttachmentList from '../components/shared/AttachmentList';
import TaskAgentThreadSection from '../components/task-detail/TaskAgentThreadSection';
import TaskStageIndicator from '../components/shared/TaskStageIndicator';
import { getTaskStage } from '../utils/taskStage';
import { CheckIcon } from '../components/shared/Icons';
import type { TodoResponse, TodoUpdate } from '../types/api';
import { isTerminalTaskStatus } from '../utils/taskStatus';
import { translateUi } from '../i18n';
import CanonicalDocumentButton from '../components/shared/CanonicalDocumentButton';
import { extractCanonicalDoc } from '../utils/canonicalDoc';
import useExperimentCompletionGate from '../hooks/useExperimentCompletionGate';
import ProjectMachineLine from '../components/shared/ProjectMachineLine';
import ProjectWorkspaceHosts from '../components/shared/ProjectWorkspaceHosts';
import Dialog from '../components/shared/Dialog';
import { useOptionalChatPanelController } from '../components/chat-panel/ChatPanelControllerContext';
import { useOpenTaskChat } from '../hooks/useContextChat';
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
    label: translateUi('Due in {{count}} days', { count: diffDays }),
    variant: 'upcoming',
  };
}
export default function TaskDetailPage() {
  const { taskId } = useParams<{
    taskId: string;
  }>();
  const navigate = useNavigate();
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
    navigate('/tasks');
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
        <button
          type="button"
          className="cc-btn cc-btn--secondary cc-mt-16"
          onClick={() => navigate('/tasks')}
        >
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
  const organize = async () => {
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
    const previous = task.assignee ?? null;
    updateTodoMutation.mutate({ id: task.id, data: { assignee } });
    useToastStore
      .getState()
      .addToast('success', translateUi(assignee ? 'Delegated to AI' : 'Back to you'), {
        duration: 5000,
        action: {
          label: translateUi('Undo'),
          onClick: () => updateTodoMutation.mutate({ id: task.id, data: { assignee: previous } }),
        },
      });
  };
  const canPlan = !hasPlan && !isTerminalTaskStatus(task.status);
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
  return (
    <div className="cc-detail cc-exec-panel">
      <div className="cc-exec-panel__top">
        <div className="cc-exec-panel__top-row">
          <Checkbox checked={task.status === 'completed'} onChange={() => handleToggle(task.id)} />
          <input
            className="cc-detail__title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={translateUi('Task title')}
          />
          <TaskMoreMenu items={menuItems} />
        </div>
        <div className="cc-exec-panel__meta-line">
          <span
            className={`cc-exec-panel__due-editor${dueInfo ? ` cc-exec-panel__info-item--${dueInfo.variant}` : ''}`}
          >
            <input
              type="date"
              className="cc-event-form__input cc-exec-panel__due-input"
              aria-label={translateUi('Due')}
              value={task.due_date ? task.due_date.slice(0, 10) : ''}
              onChange={(e) => {
                const val = e.target.value;
                persistField({
                  due_date: val ? new Date(`${val}T23:59:00`).toISOString() : null,
                });
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
            {dueInfo && <span className="cc-exec-panel__info-value">{dueInfo.label}</span>}
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
            <Link className="cc-exec-panel__context-link" to={`/tasks/${parentTask.id}`}>
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
          <div className="cc-exec-panel__stage">
            <TaskStageIndicator state={stage} variant="bar" />
          </div>
          {planIsNext && canPlan && !isPlanned && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              onClick={() => void organize()}
            >
              {translateUi('Suggest steps')}
            </button>
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
        <TaskFlow rootId={task.id} plan={hasPlan ? plan : null} />
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

      <details className="cc-exec-panel__more">
        <summary>
          {translateUi('More')}
          {task.tags?.length ? ` · ${translateUi('Tags')} ${task.tags.length}` : ''}
        </summary>
        {task.tags && task.tags.length > 0 && (
          <div className="cc-exec-panel__tags">
            {task.tags.map((tag) => (
              <Badge key={tag} variant="tag">
                {tag}
              </Badge>
            ))}
          </div>
        )}
        {taskId && (
          <div className="cc-detail__section">
            <div className="cc-detail__section-title">{translateUi('Attachments')}</div>
            <FileDropZone todoId={taskId} />
            <AttachmentList ownerId={taskId} />
          </div>
        )}
      </details>

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
