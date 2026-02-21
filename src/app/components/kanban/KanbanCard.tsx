import { useState } from 'react';
import type { TodoResponse } from '../../types/api';
import TaskCard from '../shared/TaskCard';

interface KanbanCardProps {
  task: TodoResponse;
  onToggle: () => void;
  onClick: () => void;
}

export default function KanbanCard({ task, onToggle, onClick }: KanbanCardProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  return (
    <div
      className={`cc-kanban__card${isDragging ? ' cc-kanban__card--dragging' : ''}`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <TaskCard task={task} onToggle={onToggle} onClick={onClick} />
    </div>
  );
}
