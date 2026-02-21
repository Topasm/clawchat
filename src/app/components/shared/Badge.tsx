import { formatDueDate, isOverdue, isToday, isTomorrow } from '../../utils/formatters';

interface BadgeProps {
  variant: 'priority' | 'due' | 'tag' | 'status' | 'count';
  level?: 'urgent' | 'high' | 'medium' | 'low';
  dueDate?: string;
  children?: React.ReactNode;
}

export default function Badge({ variant, level, dueDate, children }: BadgeProps) {
  let className = 'cc-badge';
  let content = children;

  if (variant === 'priority' && level) {
    className += ` cc-badge--priority-${level}`;
    content = content ?? level.charAt(0).toUpperCase() + level.slice(1);
  } else if (variant === 'due' && dueDate) {
    const dueState = isOverdue(dueDate) ? 'overdue' : isToday(dueDate) ? 'today' : isTomorrow(dueDate) ? 'tomorrow' : 'default';
    className += ` cc-badge--due-${dueState}`;
    content = content ?? formatDueDate(dueDate);
  } else if (variant === 'tag') {
    className += ' cc-badge--tag';
  } else if (variant === 'status') {
    className += ' cc-badge--status';
  } else if (variant === 'count') {
    className += ' cc-badge--count';
  }

  return <span className={className}>{content}</span>;
}
