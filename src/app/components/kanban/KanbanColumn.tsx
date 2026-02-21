import { useState } from 'react';
import type { TodoResponse, KanbanStatus } from '../../types/api';
import KanbanCard from './KanbanCard';
import EmptyState from '../shared/EmptyState';

interface KanbanColumnProps {
  status: KanbanStatus;
  title: string;
  icon: string;
  tasks: TodoResponse[];
  onDrop: (taskId: string, status: KanbanStatus) => void;
  onToggle: (id: string) => void;
  onClickTask: (id: string) => void;
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
  onDrop,
  onToggle,
  onClickTask,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only reset if leaving the column itself, not a child
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      onDrop(taskId, status);
    }
  };

  const variant = variantMap[status];

  return (
    <div
      className={`cc-kanban__column cc-kanban__column--${variant}${isDragOver ? ' cc-kanban__column--drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="cc-kanban__header">
        <span className="cc-kanban__header-icon">{icon}</span>
        <span className="cc-kanban__header-title">{title}</span>
        <span className="cc-kanban__header-count">{tasks.length}</span>
      </div>
      <div className="cc-kanban__cards">
        {tasks.length === 0 ? (
          <EmptyState icon="📋" message={`No ${title.toLowerCase()} tasks`} />
        ) : (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              onToggle={() => onToggle(task.id)}
              onClick={() => onClickTask(task.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
