import { formatDueDate, isOverdue, isToday, isTomorrow } from '../../utils/formatters';

interface BadgeProps {
  variant: 'priority' | 'due' | 'tag' | 'status' | 'count';
  level?: 'urgent' | 'high' | 'medium' | 'low';
  dueDate?: string;
  children?: React.ReactNode;
}

function PriorityIcon({ level }: { level: string }) {
  const size = 12;
  switch (level) {
    case 'urgent':
      return (
        <svg className="cc-badge__priority-icon" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 9V3M3 5l3-3 3 3" />
          <path d="M3 8l3-3 3 3" />
        </svg>
      );
    case 'high':
      return (
        <svg className="cc-badge__priority-icon" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 9V3M3 5l3-3 3 3" />
        </svg>
      );
    case 'medium':
      return (
        <svg className="cc-badge__priority-icon" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 6h8" />
        </svg>
      );
    case 'low':
      return (
        <svg className="cc-badge__priority-icon" width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 3v6M3 7l3 3 3-3" />
        </svg>
      );
    default:
      return null;
  }
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

  return (
    <span className={className}>
      {variant === 'priority' && level && <PriorityIcon level={level} />}
      {content}
    </span>
  );
}
