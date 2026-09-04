import type { CalendarTaskSegment } from '../../utils/calendarUtils';
import { translateUi } from '../../i18n';

/**
 * One day of a task's run on the calendar. Consecutive days join into a single
 * bar through the position modifier, so the stretch left to finish the task
 * reads as one shape rather than a repeated pill.
 */
export default function TaskBar({
  segment,
  showTitle,
  onClick,
}: {
  segment: CalendarTaskSegment;
  /** Only the day that opens the bar (or a new week row) carries the label. */
  showTitle: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { todo, position, isOverdue } = segment;
  const classes = ['cc-calendar__task-bar', `cc-calendar__task-bar--${position}`];
  if (isOverdue) classes.push('cc-calendar__task-bar--overdue');

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      title={
        isOverdue
          ? `${todo.title} — ${translateUi('Overdue')}`
          : `${todo.title} — ${translateUi('Due')}`
      }
    >
      {showTitle && <span className="cc-calendar__task-bar-title">{todo.title}</span>}
    </button>
  );
}
