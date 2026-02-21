import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useModuleStore } from '../../stores/useModuleStore';
import useKanbanFilters from '../../hooks/useKanbanFilters';
import type { KanbanStatus } from '../../types/api';
import KanbanColumn from './KanbanColumn';
import KanbanFilterBar from './KanbanFilterBar';
import QuickCaptureModal from '../shared/QuickCaptureModal';
import { useKanbanShortcuts } from '../../keyboard';

export default function KanbanBoard() {
  const navigate = useNavigate();
  const [showCapture, setShowCapture] = useState(false);
  const todos = useModuleStore((s) => s.todos);
  const kanbanStatuses = useModuleStore((s) => s.kanbanStatuses);
  const kanbanFilters = useModuleStore((s) => s.kanbanFilters);
  const setKanbanStatus = useModuleStore((s) => s.setKanbanStatus);
  const toggleTodoComplete = useModuleStore((s) => s.toggleTodoComplete);

  useKanbanShortcuts({ onNewTask: () => setShowCapture(true) });

  useEffect(() => {
    useModuleStore.getState().fetchTodos().catch(() => {});
  }, []);

  const filteredTodos = useKanbanFilters(todos, kanbanStatuses, kanbanFilters);

  const getEffectiveStatus = (todo: { id: string; status: string }): KanbanStatus => {
    if (kanbanStatuses[todo.id]) return kanbanStatuses[todo.id];
    return todo.status as KanbanStatus;
  };

  const todoTasks = filteredTodos.filter((t) => getEffectiveStatus(t) === 'pending');
  const inProgressTasks = filteredTodos.filter((t) => getEffectiveStatus(t) === 'in_progress');
  const doneTasks = filteredTodos.filter((t) => getEffectiveStatus(t) === 'completed');

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const taskId = result.draggableId;
    const newStatus = result.destination.droppableId as KanbanStatus;
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
      <div className="cc-page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="cc-page-header__title">All Tasks</div>
          <div className="cc-page-header__subtitle">
            {todos.length} total task{todos.length !== 1 ? 's' : ''}
          </div>
        </div>
        <button className="cc-btn cc-btn--primary" onClick={() => setShowCapture(true)}>
          + New Task
        </button>
      </div>
      <QuickCaptureModal isOpen={showCapture} onClose={() => setShowCapture(false)} />
      <KanbanFilterBar />
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="cc-kanban">
          <KanbanColumn
            status="pending"
            title="Todo"
            icon="📋"
            tasks={todoTasks}
            onToggle={handleToggle}
            onClickTask={handleClickTask}
          />
          <KanbanColumn
            status="in_progress"
            title="In Progress"
            icon="🔄"
            tasks={inProgressTasks}
            onToggle={handleToggle}
            onClickTask={handleClickTask}
          />
          <KanbanColumn
            status="completed"
            title="Done"
            icon="✅"
            tasks={doneTasks}
            onToggle={handleToggle}
            onClickTask={handleClickTask}
          />
        </div>
      </DragDropContext>
    </div>
  );
}
