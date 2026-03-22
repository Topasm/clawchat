import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { useQuickCaptureStore } from '../stores/useQuickCaptureStore';
import { useToastStore } from '../stores/useToastStore';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import apiClient from '../services/apiClient';
import Checkbox from '../components/shared/Checkbox';
import Badge from '../components/shared/Badge';
import TaskCard from '../components/shared/TaskCard';
import PlanReviewDiff from '../components/shared/PlanReviewDiff';
import RelationshipsSection from '../components/task-relationships/RelationshipsSection';
import FileDropZone from '../components/shared/FileDropZone';
import AttachmentList from '../components/shared/AttachmentList';
import type { TodoResponse, TodoUpdate } from '../types/api';

const PRIORITIES: Array<TodoResponse['priority']> = ['low', 'medium', 'high', 'urgent'];

function getDueCountdown(dueDate: string): { label: string; variant: 'overdue' | 'today' | 'upcoming' } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const absDays = Math.abs(diffDays);
    return { label: `Overdue by ${absDays} day${absDays !== 1 ? 's' : ''}`, variant: 'overdue' };
  }
  if (diffDays === 0) return { label: 'Due today', variant: 'today' };
  if (diffDays === 1) return { label: 'Due tomorrow', variant: 'upcoming' };
  return { label: `Due in ${diffDays} days`, variant: 'upcoming' };
}

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const serverUpdateTodo = useModuleStore((s) => s.serverUpdateTodo);
  const deleteTodo = useModuleStore((s) => s.deleteTodo);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  const task = todos.find((t) => t.id === taskId);
  const childTasks = todos.filter((t) => t.parent_id === taskId);
  const parentTask = task?.parent_id ? todos.find((t) => t.id === task.parent_id) : null;
  const incompleteChildren = childTasks.filter((t) => t.status !== 'completed');
  const nextSubtask = incompleteChildren[0] ?? null;

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [plan, setPlan] = useState<any>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
    }
  }, [task]);

  useEffect(() => {
    if (!taskId || task?.inbox_state !== 'plan_ready') {
      setPlan(null);
      return;
    }
    setPlanLoading(true);
    apiClient.get(`/todos/${taskId}/plan/latest`)
      .then((res) => setPlan(res.data))
      .catch(() => setPlan(null))
      .finally(() => setPlanLoading(false));
  }, [taskId, task?.inbox_state]);

  const localUpdateTodo = useCallback((id: string, updates: TodoUpdate) => {
    useModuleStore.getState().updateTodo(id, updates as Partial<TodoResponse>);
  }, []);

  const persistField = useDebouncedPersist<TodoUpdate>(taskId, serverUpdateTodo, localUpdateTodo);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    persistField({ title: val });
  };

  const handleDescriptionChange = (val: string) => {
    setDescription(val);
    persistField({ description: val });
  };

  const cyclePriority = () => {
    if (!task) return;
    const idx = PRIORITIES.indexOf(task.priority);
    const next = PRIORITIES[(idx + 1) % PRIORITIES.length];
    persistField({ priority: next });
  };

  const handleDelete = async () => {
    if (!taskId) return;
    await deleteTodo(taskId);
    navigate('/tasks');
  };

  const handleApplyPlan = async (selectedIndices?: number[]) => {
    try {
      if (selectedIndices) {
        await apiClient.post(`/todos/${taskId}/plan/apply`, { selected_indices: selectedIndices });
      } else {
        await apiClient.post(`/todos/${taskId}/plan/apply`);
      }
      useToastStore.getState().addToast('success', 'Plan applied');
      useModuleStore.getState().fetchTodos();
      setPlan(null);
    } catch {
      useToastStore.getState().addToast('error', 'Failed to apply plan');
    }
  };

  const handleDismissPlan = async () => {
    try {
      await apiClient.post(`/todos/${taskId}/plan/dismiss`);
      useToastStore.getState().addToast('info', 'Plan dismissed');
      useModuleStore.getState().fetchTodos();
      setPlan(null);
    } catch {
      useToastStore.getState().addToast('error', 'Failed to dismiss');
    }
  };

  const handleDelegate = async (agentType: string) => {
    try {
      await apiClient.post(`/todos/${taskId}/delegate`, { agent_type: agentType });
      useToastStore.getState().addToast('info', `Delegated to ${agentType}`);
    } catch {
      useToastStore.getState().addToast('error', 'Failed to delegate');
    }
  };

  if (!task) {
    return (
      <div className="cc-detail">
        <div className="cc-page-header__subtitle">Task not found</div>
        <button type="button" className="cc-btn cc-btn--secondary cc-mt-16" onClick={() => navigate('/tasks')}>
          Back to tasks
        </button>
      </div>
    );
  }

  const isProject = task.source === 'obsidian_project';
  const hasPlan = task.inbox_state === 'plan_ready' && plan;
  const isPlanned = childTasks.length > 0;
  const dueInfo = task.due_date ? getDueCountdown(task.due_date) : null;

  // Blocker info from child tasks
  const blockedByRelationships = todos.filter(
    (t) => t.parent_id === taskId && t.status !== 'completed'
  );

  return (
    <div className="cc-detail cc-exec-panel">
      {/* Top: Status + Quick Actions */}
      <div className="cc-exec-panel__top">
        <div className="cc-exec-panel__top-row">
          <Checkbox
            checked={task.status === 'completed'}
            onChange={() => toggleTodoComplete(task.id)}
          />
          <input
            className="cc-detail__title-input"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Task title"
          />
        </div>
        <div className="cc-exec-panel__badges">
          <button type="button" className="cc-detail__field-btn" onClick={cyclePriority}>
            <Badge variant="priority" level={task.priority || 'medium'} />
          </button>
          {task.status === 'completed' && (
            <Badge variant="status">Completed</Badge>
          )}
          {task.inbox_state && task.inbox_state !== 'none' && (
            <Badge variant="status">{task.inbox_state}</Badge>
          )}
        </div>
      </div>

      {/* Section 1: Next Step */}
      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">Next step</div>
        {hasPlan ? (
          <PlanReviewDiff
            plan={plan}
            onApply={handleApplyPlan}
            onDismiss={handleDismissPlan}
          />
        ) : nextSubtask ? (
          <div className="cc-exec-panel__next-step">
            <TaskCard
              task={nextSubtask}
              onToggle={() => toggleTodoComplete(nextSubtask.id)}
              onClick={() => navigate(`/tasks/${nextSubtask.id}`)}
              isSubTask
            />
            {incompleteChildren.length > 1 && (
              <span className="cc-exec-panel__remaining">
                +{incompleteChildren.length - 1} more sub-task{incompleteChildren.length - 1 !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        ) : (
          <div className="cc-exec-panel__next-step-empty">
            {task.status === 'completed' ? (
              <span className="cc-exec-panel__done-label">Task completed</span>
            ) : (
              <span className="cc-exec-panel__do-this">This task is your next step</span>
            )}
          </div>
        )}
      </div>

      {/* Section 2: Due / Estimate / Blockers */}
      {(dueInfo || task.estimated_minutes || blockedByRelationships.length > 0) && (
        <div className="cc-exec-panel__section">
          <div className="cc-exec-panel__section-title">Due / Estimate / Blockers</div>
          <div className="cc-exec-panel__info-grid">
            {dueInfo && (
              <div className={`cc-exec-panel__info-item cc-exec-panel__info-item--${dueInfo.variant}`}>
                <span className="cc-exec-panel__info-label">Due</span>
                <span className="cc-exec-panel__info-value">{dueInfo.label}</span>
              </div>
            )}
            {task.estimated_minutes && (
              <div className="cc-exec-panel__info-item">
                <span className="cc-exec-panel__info-label">Estimate</span>
                <span className="cc-exec-panel__info-value">{task.estimated_minutes}m</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Project context */}
      {(isProject || task.parent_id || task.assignee) && (
        <div className="cc-exec-panel__section">
          <div className="cc-exec-panel__section-title">Project context</div>
          <div className="cc-exec-panel__context">
            {isProject && (
              <div className="cc-exec-panel__context-row">
                <span className="cc-exec-panel__context-label">Source</span>
                <span className="cc-exec-panel__context-badge cc-exec-panel__context-badge--synced">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13.5 5l-7 7L3 8.5" />
                  </svg>
                  Obsidian project
                </span>
              </div>
            )}
            {parentTask && (
              <div className="cc-exec-panel__context-row">
                <span className="cc-exec-panel__context-label">Parent</span>
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

      {/* Section 4: Plan / Research / Execute (action bar) */}
      <div className="cc-exec-panel__section">
        <div className="cc-exec-panel__section-title">Actions</div>
        <div className="cc-exec-panel__action-bar">
          {!isPlanned && !hasPlan && task.status !== 'completed' && (
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              style={{ fontSize: 12 }}
              onClick={async () => {
                try {
                  await apiClient.post(`/todos/${taskId}/organize`);
                  useToastStore.getState().addToast('info', 'Planning...');
                } catch {
                  useToastStore.getState().addToast('error', 'Failed');
                }
              }}
            >
              Plan this task
            </button>
          )}
          {isPlanned && !hasPlan && task.status !== 'completed' && (
            <button
              type="button"
              className="cc-btn cc-btn--secondary"
              style={{ fontSize: 12 }}
              onClick={async () => {
                try {
                  await apiClient.post(`/todos/${taskId}/organize`);
                  useToastStore.getState().addToast('info', 'Re-planning...');
                } catch {
                  useToastStore.getState().addToast('error', 'Failed');
                }
              }}
            >
              Re-plan
            </button>
          )}

          {/* Delegate dropdown */}
          <div className="cc-exec-panel__delegate">
            <span className="cc-exec-panel__delegate-label">Delegate:</span>
            {(['planner', 'researcher', 'executor'] as const).map((persona) => (
              <button
                key={persona}
                type="button"
                className={`cc-btn cc-btn--ghost cc-exec-panel__delegate-btn${task.assignee === persona ? ' cc-exec-panel__delegate-btn--active' : ''}`}
                onClick={() => {
                  if (task.assignee === persona) {
                    persistField({ assignee: null });
                  } else {
                    persistField({ assignee: persona });
                    handleDelegate(persona);
                  }
                }}
              >
                {persona === 'planner' ? 'Plan' : persona === 'researcher' ? 'Research' : 'Execute'}
              </button>
            ))}
          </div>

          {task.assignee && ['planner', 'researcher', 'executor', 'openclaw'].includes(task.assignee) && (
            <div className="cc-exec-panel__agent-status">
              <span className="cc-exec-panel__agent-badge">
                {task.assignee === 'openclaw' ? 'OpenClaw AI' : task.assignee}
              </span>
              <span className="cc-exec-panel__agent-state">
                {task.inbox_state === 'planning' ? 'Planning in progress' :
                 task.inbox_state === 'classifying' ? 'Classifying...' :
                 task.inbox_state === 'plan_ready' ? 'Plan ready for review' :
                 'Assigned'}
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
          <svg
            className={`cc-section__chevron${detailsOpen ? ' cc-section__chevron--open' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Details
          {(task.tags?.length || childTasks.length > 0) && (
            <span className="cc-exec-panel__details-hint">
              {[
                task.tags?.length ? `${task.tags.length} tags` : '',
                childTasks.length > 0 ? `${childTasks.length} sub-tasks` : '',
                description ? 'has description' : '',
              ].filter(Boolean).join(', ')}
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
            placeholder="Add a description..."
          />

          {/* Tags */}
          {task.tags && task.tags.length > 0 && (
            <div className="cc-detail__field" style={{ borderBottom: 'none' }}>
              <span className="cc-detail__field-label">Tags</span>
              <div className="cc-detail__field-value" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {task.tags.map((tag) => (
                  <Badge key={tag} variant="tag">{tag}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Sub-tasks list */}
          <div className="cc-detail__section">
            <div className="cc-detail__section-title">
              Sub-tasks{childTasks.length > 0 ? ` (${childTasks.length})` : ''}
            </div>
            {childTasks.map((child) => (
              <TaskCard
                key={child.id}
                task={child}
                onToggle={() => toggleTodoComplete(child.id)}
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
              + Add sub-task
            </button>
          </div>

          {/* Relationships */}
          {taskId && <RelationshipsSection taskId={taskId} />}

          {/* Attachments */}
          {taskId && (
            <div className="cc-detail__section">
              <div className="cc-detail__section-title">Attachments</div>
              <FileDropZone todoId={taskId} />
              <AttachmentList ownerId={taskId} ownerType="todo" />
            </div>
          )}
        </div>
      )}

      {/* Delete button */}
      <button type="button" className="cc-btn cc-btn--danger cc-detail__delete-btn" onClick={handleDelete}>
        Delete Task
      </button>
    </div>
  );
}
