import type { CalendarTaskSegment } from '../../utils/calendarUtils';
import { translateUi } from '../../i18n';

/** A task's deadline on the calendar, on the day it is due. */
export default function TaskBar({
  segment,
  onClick,
}: {
  segment: CalendarTaskSegment;
  onClick: (e: React.MouseEvent) => void;
}) {
  const { todo, isOverdue } = segment;
  const classes = ['cc-calendar__task-bar'];
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
      <span className="cc-calendar__task-bar-title">{todo.title}</span>
    </button>
  );
}
