import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import { useDebouncedPersist } from '../hooks/useDebouncedPersist';
import Checkbox from '../components/shared/Checkbox';
import Badge from '../components/shared/Badge';
import TaskCard from '../components/shared/TaskCard';
import RelationshipsSection from '../components/task-relationships/RelationshipsSection';
import QuickCaptureModal from '../components/shared/QuickCaptureModal';
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
  const [showSubTaskCapture, setShowSubTaskCapture] = useState(false);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
    }
  }, [task]);

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

      <div className="cc-detail__field">
        <span className="cc-detail__field-label">Status</span>
        <div className="cc-detail__field-value">
          <Badge variant="status">{task.status}</Badge>
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
          onClick={() => setShowSubTaskCapture(true)}
        >
          + Add sub-task
        </button>
        <QuickCaptureModal
          isOpen={showSubTaskCapture}
          onClose={() => setShowSubTaskCapture(false)}
          defaultParentId={taskId}
        />
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

      <button type="button" className="cc-btn cc-btn--danger cc-detail__delete-btn" onClick={handleDelete}>
        Delete Task
      </button>
    </div>
  );
}
