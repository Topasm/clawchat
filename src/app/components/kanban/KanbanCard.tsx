import { useEffect, useRef } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import type { TodoResponse } from '../../types/api';
import TaskCard from '../shared/TaskCard';

interface KanbanCardProps {
  task: TodoResponse;
  index: number;
  onToggle: () => void;
  onClick: () => void;
  isFocused?: boolean;
  onFocus?: () => void;
}

export default function KanbanCard({ task, index, onToggle, onClick, isFocused, onFocus }: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isFocused]);

  const handleClick = () => {
    onFocus?.();
  };

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={(el) => {
            provided.innerRef(el);
            (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`cc-kanban__card${snapshot.isDragging ? ' cc-kanban__card--dragging' : ''}${isFocused ? ' cc-kanban__card--focused' : ''}`}
          onClick={handleClick}
        >
          <TaskCard task={task} onToggle={onToggle} onClick={onClick} />
        </div>
      )}
    </Draggable>
  );
}
