import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import TaskCard from '../components/shared/TaskCard';
import EmptyState from '../components/shared/EmptyState';

export default function InboxPage() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    useModuleStore.getState().fetchTodos().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load');
    });
  }, []);

  const handleToggle = (id: string) => {
    useModuleStore.getState().toggleTodoComplete(id).catch(() => {});
  };

  const inboxTasks = Array.isArray(todos)
    ? todos.filter((t) => !t.due_date && t.status !== 'completed')
    : [];

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">Inbox</div>
        <div className="cc-page-header__subtitle">
          {inboxTasks.length > 0
            ? `${inboxTasks.length} unscheduled task${inboxTasks.length !== 1 ? 's' : ''}`
            : 'Tasks without a due date'}
        </div>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', marginBottom: 12, borderRadius: 8, background: 'var(--cc-delete-bg)', color: 'var(--cc-error)', fontSize: 13 }}>
          Could not connect to server: {error}
        </div>
      )}

      {inboxTasks.length === 0 ? (
        <EmptyState icon={'\uD83C\uDF1F'} message="Inbox Zero! All tasks are scheduled." />
      ) : (
        inboxTasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            onToggle={() => handleToggle(task.id)}
            onClick={() => navigate(`/tasks/${task.id}`)}
          />
        ))
      )}
    </div>
  );
}
