import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import {
  useTodosQuery,
  useUpdateTodo,
  useDeleteTodo,
  useToggleTodoComplete,
  useLatestPlanProposalQuery,
  useGeneratePlanProposal,
  useApplyPlanProposal,
  useDismissPlanProposal,
  queryKeys,
} from '../hooks/queries';
import apiClient from '../services/apiClient';
import Checkbox from '../components/shared/Checkbox';
import Badge from '../components/shared/Badge';
import TaskCard from '../components/shared/TaskCard';
import PlanReviewDiff from '../components/shared/PlanReviewDiff';
import RecurrenceSelector from '../components/shared/RecurrenceSelector';
import RelationshipsSection from '../components/task-relationships/RelationshipsSection';
import FileDropZone from '../components/shared/FileDropZone';
import AttachmentList from '../components/shared/AttachmentList';
import TaskAgentThreadSection from '../components/task-detail/TaskAgentThreadSection';
import { CheckIcon, ChevronRightIcon } from '../components/shared/Icons';
import type { TodoResponse, TodoUpdate } from '../types/api';
import { getTaskStatusLabel, isTerminalTaskStatus } from '../utils/taskStatus';
import { translateUi } from '../i18n';
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
  const task = todos.find((t) => t.id === taskId);
  const latestPlanQuery = useLatestPlanProposalQuery(taskId, Boolean(task));
  const generatePlanMutation = useGeneratePlanProposal();
  const applyPlanMutation = useApplyPlanProposal();
  const dismissPlanMutation = useDismissPlanProposal();
  const childTasks = todos.filter((t) => t.parent_id === taskId);
  const parentTask = task?.parent_id ? todos.find((t) => t.id === task.parent_id) : null;
  const incompleteChildren = childTasks.filter((t) => !isTerminalTaskStatus(t.status));
  const nextSubtask = incompleteChildren[0] ?? null;
  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const plan = latestPlanQuery.data ?? null;
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
      if (todo) toggleCompleteMutation.mutate({ id, currentStatus: todo.status });
    },
    [todos, toggleCompleteMutation],
  );
  const handleApplyPlan = async (selectedIndices: number[]) => {
    if (!taskId || !plan || plan.base_graph_revision === null) return;
    await applyPlanMutation.mutateAsync({
      todoId: taskId,
      proposalId: plan.proposal_id,
      baseGraphRevision: plan.base_graph_revision,
      selectedIndices,
      subtasks: plan.subtasks,
    });
  };
  const handleDismissPlan = async () => {
    if (!taskId || !plan) return;
    await dismissPlanMutation.mutateAsync({ todoId: taskId, proposalId: plan.proposal_id });
    useToastStore.getState().addToast('info', translateUi('Plan dismissed'));
  };
  const handleRegeneratePlan = async () => {
    if (!taskId) return;
    await generatePlanMutation.mutateAsync({ todoId: taskId });
    applyPlanMutation.reset();
  };
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
  return (
    <div className="cc-detail cc-exec-panel">
      {/* Top: Status + Quick Actions */}
      <div className="cc-exec-panel__top">
        <div className="cc-exec-panel__top-row">
          <Checkbox checked={task.status === 'completed'} onChange={() => handleToggle(task.id)} />
          <input
            className="cc-detail__title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder={translateUi('Task title')}
          />
        </div>
        <div className="cc-exec-panel__badges">
          {task.status !== 'pending' && (
            <Badge variant="status">{getTaskStatusLabel(task.status)}</Badge>
          )}
          {task.inbox_state && task.inbox_state !== 'none' && (
            <Badge variant="status">{task.inbox_state}</Badge>
          )}
        </div>
      </div>

      {/* Section 1: Next Step */}
      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">{translateUi('Next step')}</div>
        {hasPlan ? (
          <PlanReviewDiff
            plan={plan}
            onApply={handleApplyPlan}
            onDismiss={handleDismissPlan}
            onRegenerate={handleRegeneratePlan}
            applyError={applyPlanMutation.error}
            isApplying={applyPlanMutation.isPending}
            isDismissing={dismissPlanMutation.isPending}
            isRegenerating={generatePlanMutation.isPending}
          />
        ) : nextSubtask ? (
          <div className="cc-exec-panel__next-step">
            <TaskCard
              task={nextSubtask}
              onToggle={() => handleToggle(nextSubtask.id)}
              onClick={() => navigate(`/tasks/${nextSubtask.id}`)}
              isSubTask
            />
            {incompleteChildren.length > 1 && (
              <span className="cc-exec-panel__remaining">
                +{incompleteChildren.length - 1}
                {translateUi(' more sub-task\n                ')}
                {incompleteChildren.length - 1 !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        ) : (
          <div className="cc-exec-panel__next-step-empty">
            {isTerminalTaskStatus(task.status) ? (
              <span className="cc-exec-panel__done-label">
                {task.status === 'completed'
                  ? translateUi('Task completed')
                  : translateUi('Task cancelled')}
              </span>
            ) : (
              <span className="cc-exec-panel__do-this">
                {translateUi('This task is your next step')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Due / Estimate / Recurrence / Blockers */}
      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">
          {translateUi('Due / Estimate / Blockers')}
        </div>
        <div className="cc-exec-panel__info-grid">
          <div
            className={`cc-exec-panel__info-item${dueInfo ? ` cc-exec-panel__info-item--${dueInfo.variant}` : ''}`}
          >
            <span className="cc-exec-panel__info-label">{translateUi('Due')}</span>
            <div className="cc-exec-panel__due-editor">
              <input
                type="date"
                className="cc-event-form__input cc-exec-panel__due-input"
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
            </div>
            {dueInfo && <span className="cc-exec-panel__info-value">{dueInfo.label}</span>}
          </div>
          {task.estimated_minutes && (
            <div className="cc-exec-panel__info-item">
              <span className="cc-exec-panel__info-label">{translateUi('Estimate')}</span>
              <span className="cc-exec-panel__info-value">{task.estimated_minutes}m</span>
            </div>
          )}
        </div>
      </div>

      {/* Section 2b: Recurrence */}
      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">{translateUi('Repeat')}</div>
        <RecurrenceSelector
          value={task.recurrence_rule ?? undefined}
          onChange={(rule) => persistField({ recurrence_rule: rule ?? null })}
        />
      </div>

      {/* Section 3: Project context */}
      {(isProject || task.parent_id || task.assignee) && (
        <div className="cc-exec-panel__section">
          <div className="cc-exec-panel__section-title">{translateUi('Project context')}</div>
          <div className="cc-exec-panel__context">
            {isProject && (
              <div className="cc-exec-panel__context-row">
                <span className="cc-exec-panel__context-label">{translateUi('Source')}</span>
                <span className="cc-exec-panel__context-badge cc-exec-panel__context-badge--synced">
                  <CheckIcon size={12} />
                  {translateUi('\n                  Obsidian project\n                ')}
                </span>
              </div>
            )}
            {parentTask && (
              <div className="cc-exec-panel__context-row">
                <span className="cc-exec-panel__context-label">{translateUi('Parent')}</span>
                <span
                  className="cc-exec-panel__context-link"
                  onClick={() => navigate(`/tasks/${parentTask.id}`)}
                >
                  {parentTask.title}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <TaskAgentThreadSection taskId={task.id} />

      {/* Section 4: Plan / Research / Execute (action bar) */}
      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">{translateUi('Actions')}</div>
        <div className="cc-exec-panel__action-bar">
          {!isPlanned && !hasPlan && !isTerminalTaskStatus(task.status) && (
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              style={{ fontSize: 12 }}
              onClick={async () => {
                try {
                  await apiClient.post(`/todos/${taskId}/organize`);
                  useToastStore.getState().addToast('info', translateUi('Planning...'));
                } catch {
                  useToastStore.getState().addToast('error', translateUi('Failed'));
                }
              }}
            >
              {translateUi('\n              Plan this task\n            ')}
            </button>
          )}
          {isPlanned && !hasPlan && !isTerminalTaskStatus(task.status) && (
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              style={{ fontSize: 12 }}
              onClick={async () => {
                try {
                  await apiClient.post(`/todos/${taskId}/organize`);
                  useToastStore.getState().addToast('info', translateUi('Re-planning...'));
                } catch {
                  useToastStore.getState().addToast('error', translateUi('Failed'));
                }
              }}
            >
              {translateUi('\n              Re-plan\n            ')}
            </button>
          )}

          {/* Skill delegate buttons */}
          <div className="cc-exec-panel__delegate">
            <span className="cc-exec-panel__delegate-label">{translateUi('Skills:')}</span>
            {SKILL_OPTIONS.map(({ id, label }) => {
              const isActive = task.enabled_skills?.includes(id) || task.assignee === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`cc-btn cc-btn--ghost cc-exec-panel__delegate-btn${isActive ? ' cc-exec-panel__delegate-btn--active' : ''}`}
                  onClick={() => {
                    if (isActive) {
                      const updated = (task.enabled_skills || []).filter((s) => s !== id);
                      persistField({
                        enabled_skills: updated.length ? updated : null,
                        assignee: updated[0] || null,
                      });
                    } else {
                      const updated = [...(task.enabled_skills || []), id];
                      persistField({ enabled_skills: updated, assignee: id });
                    }
                  }}
                >
                  {translateUi(label)}
                </button>
              );
            })}
          </div>

          {(task.enabled_skills?.length ||
            (task.assignee &&
              ['planner', 'researcher', 'executor', 'openclaw'].includes(task.assignee))) && (
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
                      : translateUi('Assigned \u00B7 start from Inbox when Ready')}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Collapsed details */}
      <div className="cc-exec-panel__details-toggle">
        <button
          type="button"
          className="cc-exec-panel__details-btn"
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <ChevronRightIcon
            size={16}
            className={`cc-section__chevron${detailsOpen ? ' cc-section__chevron--open' : ''}`}
          />
          {translateUi('\n          Details\n          ')}
          {(task.tags?.length || childTasks.length > 0) && (
            <span className="cc-exec-panel__details-hint">
              {[
                task.tags?.length ? `${task.tags.length} tags` : '',
                childTasks.length > 0 ? `${childTasks.length} sub-tasks` : '',
                description ? 'has description' : '',
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          )}
        </button>
      </div>

      {detailsOpen && (
        <div className="cc-exec-panel__details">
          {/* Description */}
          <textarea
            className="cc-detail__textarea"
            value={description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
            placeholder={translateUi('Add a description...')}
          />

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div className="cc-detail__field" style={{ borderBottom: 'none' }}>
              <span className="cc-detail__field-label">{translateUi('Tags')}</span>
              <div
                className="cc-detail__field-value"
                style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}
              >
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="tag">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Sub-tasks list */}
          <div className="cc-detail__section">
            <div className="cc-detail__section-title">
              {translateUi('\n              Sub-tasks')}
              {childTasks.length > 0 ? ` (${childTasks.length})` : ''}
            </div>
            {childTasks.map((child) => (
              <TaskCard
                key={child.id}
                task={child}
                onToggle={() => handleToggle(child.id)}
                onClick={() => navigate(`/tasks/${child.id}`)}
                isSubTask
              />
            ))}
            <button
              type="button"
              className="cc-btn cc-btn--ghost"
              style={{ fontSize: 12, marginTop: 4 }}
              onClick={() => useQuickCaptureStore.getState().open({ defaultParentId: taskId })}
            >
              {translateUi('\n              + Add sub-task\n            ')}
            </button>
          </div>

          {/* Relationships */}
          {taskId && <RelationshipsSection taskId={taskId} />}

          {/* Attachments */}
          {taskId && (
            <div className="cc-detail__section">
              <div className="cc-detail__section-title">{translateUi('Attachments')}</div>
              <FileDropZone todoId={taskId} />
              <AttachmentList ownerId={taskId} />
            </div>
          )}
        </div>
      )}

      {/* Delete button */}
      <button
        type="button"
        className="cc-btn cc-btn--danger cc-detail__delete-btn"
        onClick={handleDelete}
      >
        {translateUi('\n        Delete Task\n      ')}
      </button>
    </div>
  );
}
