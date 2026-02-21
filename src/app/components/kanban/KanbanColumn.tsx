import { Droppable } from '@hello-pangea/dnd';
import type { TodoResponse, KanbanStatus } from '../../types/api';
import KanbanCard from './KanbanCard';
import EmptyState from '../shared/EmptyState';

interface KanbanColumnProps {
  status: KanbanStatus;
  title: string;
  icon: string;
  tasks: TodoResponse[];
  onToggle: (id: string) => void;
  onClickTask: (id: string) => void;
  focusedTaskId?: string | null;
  onFocusTask?: (id: string) => void;
}

const variantMap: Record<KanbanStatus, string> = {
  pending: 'todo',
  in_progress: 'progress',
  completed: 'done',
};

export default function KanbanColumn({
  status,
  title,
  icon,
  tasks,
  onToggle,
  onClickTask,
  focusedTaskId,
  onFocusTask,
}: KanbanColumnProps) {
  const variant = variantMap[status];

  return (
    <Droppable droppableId={status}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={`cc-kanban__column cc-kanban__column--${variant}${snapshot.isDraggingOver ? ' cc-kanban__column--drag-over' : ''}`}
        >
          <div className="cc-kanban__header">
            <span className="cc-kanban__header-icon">{icon}</span>
            <span className="cc-kanban__header-title">{title}</span>
            <span className="cc-kanban__header-count">{tasks.length}</span>
          </div>
          <div className="cc-kanban__cards">
            {tasks.length === 0 && !snapshot.isDraggingOver ? (
              <EmptyState icon="📋" message={`No ${title.toLowerCase()} tasks`} />
            ) : (
              tasks.map((task, index) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  index={index}
                  onToggle={() => onToggle(task.id)}
                  onClick={() => onClickTask(task.id)}
                  isFocused={focusedTaskId === task.id}
                  onFocus={() => onFocusTask?.(task.id)}
                />
              ))
            )}
            {provided.placeholder}
          </div>
        </div>
      )}
    </Droppable>
  );
}
