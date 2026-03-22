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
import RelationshipsSection from '../components/task-relationships/RelationshipsSection';
import FileDropZone from '../components/shared/FileDropZone';
import AttachmentList from '../components/shared/AttachmentList';
import type { TodoResponse, TodoUpdate } from '../types/api';

const PRIORITIES: Array<TodoResponse['priority']> = ['low', 'medium', 'high', 'urgent'];

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

  const [title, setTitle] = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [plan, setPlan] = useState<any>(null);
  const [planLoading, setPlanLoading] = useState(false);

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

  return (
    <div className="cc-detail">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
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

      <div className="cc-detail__field">
        <span className="cc-detail__field-label">Priority</span>
        <div className="cc-detail__field-value">
          <button type="button" className="cc-detail__field-btn" onClick={cyclePriority}>
            <Badge variant="priority" level={task.priority || 'medium'} />
          </button>
        </div>
      </div>

      {task.due_date && (
        <div className="cc-detail__field">
          <span className="cc-detail__field-label">Due date</span>
          <div className="cc-detail__field-value">
            <Badge variant="due" dueDate={task.due_date} />
          </div>
        </div>
      )}

      {task.estimated_minutes && (
        <div className="cc-detail__field">
          <span className="cc-detail__field-label">Estimate</span>
          <div className="cc-detail__field-value">
            <span style={{ fontSize: 13 }}>{task.estimated_minutes}m</span>
          </div>
        </div>
      )}

      <div className="cc-detail__field">
        <span className="cc-detail__field-label">Status</span>
        <div className="cc-detail__field-value">
          <Badge variant="status">{task.status}</Badge>
        </div>
      </div>

      {task.inbox_state && task.inbox_state !== 'none' && (
        <div className="cc-detail__field">
          <span className="cc-detail__field-label">Inbox</span>
          <div className="cc-detail__field-value">
            <Badge variant="status">{task.inbox_state}</Badge>
          </div>
        </div>
      )}

      <div className="cc-detail__field">
        <span className="cc-detail__field-label">Assignee</span>
        <div className="cc-detail__field-value" style={{ display: 'flex', gap: 4 }}>
          {(['planner', 'researcher', 'executor'] as const).map((persona) => (
            <button
              key={persona}
              type="button"
              className="cc-btn cc-btn--ghost"
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: task.assignee === persona ? '#6366F1' : 'transparent',
                color: task.assignee === persona ? '#fff' : 'var(--cc-text-tertiary)',
                fontWeight: task.assignee === persona ? 600 : 400,
              }}
              onClick={() => {
                const next = task.assignee === persona ? null : persona;
                persistField({ assignee: next });
              }}
            >
              {persona}
            </button>
          ))}
          {task.assignee === 'openclaw' && (
            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, backgroundColor: '#6366F1', color: '#fff', fontWeight: 600 }}>
              OpenClaw AI
            </span>
          )}
          {!task.assignee && (
            <span style={{ color: 'var(--cc-text-tertiary)', fontSize: 12 }}>Unassigned</span>
          )}
        </div>
      </div>

      {task.tags && task.tags.length > 0 && (
        <div className="cc-detail__field">
          <span className="cc-detail__field-label">Tags</span>
          <div className="cc-detail__field-value" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {task.tags.map((tag) => (
              <Badge key={tag} variant="tag">{tag}</Badge>
            ))}
          </div>
        </div>
      )}

      <textarea
        className="cc-detail__textarea"
        value={description}
        onChange={(e) => handleDescriptionChange(e.target.value)}
        placeholder="Add a description..."
      />

      {/* Parent link */}
      {parentTask && (
        <div className="cc-detail__section">
          <div className="cc-detail__section-title">Parent Task</div>
          <span
            style={{ fontSize: 13, color: 'var(--cc-primary)', cursor: 'pointer' }}
            onClick={() => navigate(`/tasks/${parentTask.id}`)}
          >
            {parentTask.title}
          </span>
        </div>
      )}

      {/* Plan section */}
      {plan && (
        <div className="cc-detail__section">
          <div className="cc-detail__section-title">Plan</div>
          <p style={{ fontSize: 13, color: 'var(--cc-text-secondary)', margin: '0 0 8px' }}>
            {plan.summary}
          </p>
          {plan.subtasks && plan.subtasks.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--cc-text-tertiary)' }}>
              {plan.subtasks.map((s: any, i: number) => (
                <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--cc-border)' }}>
                  <strong>{s.title}</strong>
                  {s.estimated_minutes && <span style={{ marginLeft: 8 }}>{s.estimated_minutes}m</span>}
                  {s.due_date && <span style={{ marginLeft: 8 }}>{s.due_date}</span>}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              className="cc-btn cc-btn--primary"
              style={{ fontSize: 12 }}
              onClick={async () => {
                try {
                  await apiClient.post(`/todos/${taskId}/plan/apply`);
                  useToastStore.getState().addToast('success', 'Plan applied');
                  useModuleStore.getState().fetchTodos();
                  setPlan(null);
                } catch { useToastStore.getState().addToast('error', 'Failed to apply plan'); }
              }}
            >
              Apply Plan
            </button>
            <button
              className="cc-btn cc-btn--ghost"
              style={{ fontSize: 12 }}
              onClick={async () => {
                try {
                  await apiClient.post(`/todos/${taskId}/plan/dismiss`);
                  useToastStore.getState().addToast('info', 'Plan dismissed');
                  useModuleStore.getState().fetchTodos();
                  setPlan(null);
                } catch { useToastStore.getState().addToast('error', 'Failed to dismiss'); }
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Sub-tasks section */}
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

      {/* Relationships section */}
      {taskId && <RelationshipsSection taskId={taskId} />}

      {/* Attachments section */}
      {taskId && (
        <div className="cc-detail__section">
          <div className="cc-detail__section-title">Attachments</div>
          <FileDropZone todoId={taskId} />
          <AttachmentList ownerId={taskId} ownerType="todo" />
        </div>
      )}

      {/* Actions section */}
      <div className="cc-detail__section">
        <div className="cc-detail__section-title">Actions</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="cc-btn cc-btn--secondary"
            style={{ fontSize: 12 }}
            onClick={async () => {
              try {
                await apiClient.post(`/todos/${taskId}/organize`);
                useToastStore.getState().addToast('info', 'Organizing...');
              } catch { useToastStore.getState().addToast('error', 'Failed'); }
            }}
          >
            Run Planner
          </button>
          <button
            className="cc-btn cc-btn--secondary"
            style={{ fontSize: 12 }}
            onClick={async () => {
              try {
                await apiClient.post(`/todos/${taskId}/delegate`, { agent_type: 'researcher' });
                useToastStore.getState().addToast('info', 'Delegated to researcher');
              } catch { useToastStore.getState().addToast('error', 'Failed'); }
            }}
          >
            Delegate: Researcher
          </button>
          <button
            className="cc-btn cc-btn--secondary"
            style={{ fontSize: 12 }}
            onClick={async () => {
              try {
                await apiClient.post(`/todos/${taskId}/delegate`, { agent_type: 'executor' });
                useToastStore.getState().addToast('info', 'Delegated to executor');
              } catch { useToastStore.getState().addToast('error', 'Failed'); }
            }}
          >
            Delegate: Executor
          </button>
        </div>
      </div>

      <button type="button" className="cc-btn cc-btn--danger cc-detail__delete-btn" onClick={handleDelete}>
        Delete Task
      </button>
    </div>
  );
}
