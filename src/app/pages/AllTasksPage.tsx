import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../stores/useModuleStore';
import SectionHeader from '../components/shared/SectionHeader';
import TaskCard from '../components/shared/TaskCard';
import EmptyState from '../components/shared/EmptyState';

export default function AllTasksPage() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  useEffect(() => {
    useModuleStore.getState().fetchTodos().catch(() => {});
  }, []);

  const inProgress = todos.filter((t) => t.status === 'pending' && t.due_date);
  const pending = todos.filter((t) => t.status === 'pending' && !t.due_date);
  const completed = todos.filter((t) => t.status === 'completed');

  // Only show completed from last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentCompleted = completed.filter((t) => new Date(t.updated_at) >= sevenDaysAgo);

  const hasAny = inProgress.length > 0 || pending.length > 0 || recentCompleted.length > 0;

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">All Tasks</div>
        <div className="cc-page-header__subtitle">
          {todos.length} total task{todos.length !== 1 ? 's' : ''}
        </div>
      </div>

      {!hasAny && (
        <EmptyState icon={'\u2705'} message="No tasks yet. Create one from the inbox or chat." />
      )}

      {inProgress.length > 0 && (
        <SectionHeader title="Scheduled" count={inProgress.length} variant="accent">
          {inProgress.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {pending.length > 0 && (
        <SectionHeader title="Unscheduled" count={pending.length}>
          {pending.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}

      {recentCompleted.length > 0 && (
        <SectionHeader title="Completed" count={recentCompleted.length} variant="success" defaultOpen={false}>
          {recentCompleted.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onToggle={() => toggleTodoComplete(task.id)}
              onClick={() => navigate(`/tasks/${task.id}`)}
            />
          ))}
        </SectionHeader>
      )}
    </div>
  );
}
