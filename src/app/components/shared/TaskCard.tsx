import type { TodoResponse } from '../../types/api';
import Checkbox from './Checkbox';
import Badge from './Badge';
import BlockerBadge from '../task-relationships/BlockerBadge';

interface TaskCardProps {
  task: TodoResponse;
  onToggle: () => void;
  onClick: () => void;
  className?: string;
  isSubTask?: boolean;
  subTaskCount?: number;
  blockerCount?: number;
}

export default function TaskCard({ task, onToggle, onClick, className, isSubTask, subTaskCount, blockerCount }: TaskCardProps) {
  const isCompleted = task.status === 'completed';

  return (
    <div className={`cc-card cc-card--task${className ? ' ' + className : ''}${isSubTask ? ' cc-kanban__card--subtask' : ''}`} onClick={onClick}>
      <Checkbox checked={isCompleted} onChange={onToggle} />
      <div className="cc-card__body">
        <div className={`cc-card__title${isCompleted ? ' cc-card__title--completed' : ''}`}>
          {task.title}
        </div>
        <div className="cc-card__meta">
          {task.priority && task.priority !== 'medium' && (
            <Badge variant="priority" level={task.priority} />
          )}
          {task.due_date && (
            <Badge variant="due" dueDate={task.due_date} />
          )}
          {task.tags?.map((tag) => (
            <Badge key={tag} variant="tag">{tag}</Badge>
          ))}
          {(blockerCount ?? 0) > 0 && <BlockerBadge count={blockerCount!} />}
          {(subTaskCount ?? 0) > 0 && (
            <span className="cc-badge cc-badge--count">{subTaskCount} sub-task{subTaskCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </div>
    </div>
  );
}
