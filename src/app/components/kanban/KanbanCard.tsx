import { Draggable } from '@hello-pangea/dnd';
import type { TodoResponse } from '../../types/api';
import TaskCard from '../shared/TaskCard';

interface KanbanCardProps {
  task: TodoResponse;
  index: number;
  onToggle: () => void;
  onClick: () => void;
}

export default function KanbanCard({ task, index, onToggle, onClick }: KanbanCardProps) {
  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`cc-kanban__card${snapshot.isDragging ? ' cc-kanban__card--dragging' : ''}`}
        >
          <TaskCard task={task} onToggle={onToggle} onClick={onClick} />
        </div>
      )}
    </Draggable>
  );
}
