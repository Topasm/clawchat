import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useModuleStore } from '../../stores/useModuleStore';
import type { KanbanStatus } from '../../types/api';
import KanbanColumn from './KanbanColumn';

export default function KanbanBoard() {
  const navigate = useNavigate();
  const todos = useModuleStore((s) => s.todos);
  const kanbanStatuses = useModuleStore((s) => s.kanbanStatuses);
  const setKanbanStatus = useModuleStore((s) => s.setKanbanStatus);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  useEffect(() => {
    useModuleStore.getState().fetchTodos().catch(() => {});
  }, []);

  const getEffectiveStatus = (todo: { id: string; status: string }): KanbanStatus => {
    if (kanbanStatuses[todo.id]) return kanbanStatuses[todo.id];
    return todo.status as KanbanStatus;
  };

  const todoTasks = todos.filter((t) => getEffectiveStatus(t) === 'pending');
  const inProgressTasks = todos.filter((t) => getEffectiveStatus(t) === 'in_progress');
  const doneTasks = todos.filter((t) => getEffectiveStatus(t) === 'completed');

  const handleDrop = (taskId: string, newStatus: KanbanStatus) => {
    setKanbanStatus(taskId, newStatus);
  };

  const handleToggle = (id: string) => {
    toggleTodoComplete(id);
  };

  const handleClickTask = (id: string) => {
    navigate(`/tasks/${id}`);
  };

  return (
    <div>
      <div className="cc-page-header">
        <div className="cc-page-header__title">All Tasks</div>
        <div className="cc-page-header__subtitle">
          {todos.length} total task{todos.length !== 1 ? 's' : ''}
        </div>
      </div>
      <div className="cc-kanban">
        <KanbanColumn
          status="pending"
          title="Todo"
          icon="📋"
          tasks={todoTasks}
          onDrop={handleDrop}
          onToggle={handleToggle}
          onClickTask={handleClickTask}
        />
        <KanbanColumn
          status="in_progress"
          title="In Progress"
          icon="🔄"
          tasks={inProgressTasks}
          onDrop={handleDrop}
          onToggle={handleToggle}
          onClickTask={handleClickTask}
        />
        <KanbanColumn
          status="completed"
          title="Done"
          icon="✅"
          tasks={doneTasks}
          onDrop={handleDrop}
          onToggle={handleToggle}
          onClickTask={handleClickTask}
        />
      </div>
    </div>
  );
}
