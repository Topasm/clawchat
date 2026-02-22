import { useEffect, useRef } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import type { TodoResponse } from '../../types/api';
import TaskCard from '../shared/TaskCard';
import useTouchSelect from '../../hooks/useTouchSelect';

interface KanbanCardProps {
  task: TodoResponse;
  index: number;
  onToggle: () => void;
  onClick: () => void;
  isFocused?: boolean;
  onFocus?: () => void;
  isSelected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onSelectTouch?: (id: string) => void;
  isSubTask?: boolean;
  subTaskCount?: number;
  isDragDisabled?: boolean;
  isMobile?: boolean;
}

export default function KanbanCard({ task, index, onToggle, onClick, isFocused, onFocus, isSelected, onSelect, onSelectTouch, isSubTask, subTaskCount, isDragDisabled, isMobile }: KanbanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const touchSelectHandlers = useTouchSelect({
    taskId: task.id,
    onSelect: onSelectTouch ?? (() => {}),
  });

  useEffect(() => {
    if (isFocused && cardRef.current) {
      cardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isFocused]);

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      onSelect?.(e);
      return;
    }
    onFocus?.();
  };

  return (
    <Draggable draggableId={task.id} index={index} isDragDisabled={isDragDisabled}>
      {(provided, snapshot) => (
        <div
          ref={(el) => {
            provided.innerRef(el);
            (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }}
          {...provided.draggableProps}
          {...(isMobile ? {} : provided.dragHandleProps)}
          className={`cc-kanban__card${snapshot.isDragging ? ' cc-kanban__card--dragging' : ''}${isFocused ? ' cc-kanban__card--focused' : ''}${isSelected ? ' cc-kanban__card--selected' : ''}`}
          onClick={handleClick}
          {...touchSelectHandlers}
        >
          {isMobile && (
            <div className="cc-kanban__drag-handle" {...provided.dragHandleProps}>
              <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">
                <circle cx="2" cy="2" r="1.5" />
                <circle cx="8" cy="2" r="1.5" />
                <circle cx="2" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="2" cy="14" r="1.5" />
                <circle cx="8" cy="14" r="1.5" />
              </svg>
            </div>
          )}
          <TaskCard task={task} onToggle={onToggle} onClick={onClick} isSubTask={isSubTask} subTaskCount={subTaskCount} />
        </div>
      )}
    </Draggable>
  );
}
