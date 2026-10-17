import type { MouseEvent } from 'react';
import { isOverdue } from '../../utils/formatters';
import { PauseIcon } from './Icons';
import { translateUi } from '../../i18n';

/** An unfinished prerequisite as the server names it on `open_prerequisites`. */
export interface Prerequisite {
  id: string;
  title: string;
}

/** A prerequisite's title as a row prints it: cut so the line stays one line. */
const MAX_TITLE = 20;

function shortTitle(title: string): string {
  return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}

export interface WaitingOnText {
  label: string;
  /** The one prerequisite the line names, for the click that goes to it. */
  target: Prerequisite | null;
}

/**
 * One line for a list row: what an active task is waiting on.
 *
 * The server names the unfinished prerequisites (`open_prerequisites`), so a
 * row can say "Waiting on · Profile the kernel" without opening the graph.
 * Null when nothing blocks the task. `isRunning` says whether that
 * prerequisite has an agent on it right now, which turns "waiting" into
 * "in progress".
 */
export function waitingOnLine(
  prerequisites: Prerequisite[] | null | undefined,
  isRunning?: (taskId: string) => boolean,
): WaitingOnText | null {
  if (!prerequisites || prerequisites.length === 0) return null;
  if (prerequisites.length === 1) {
    const [target] = prerequisites;
    const title = shortTitle(target.title);
    return {
      label: isRunning?.(target.id)
        ? translateUi('Prerequisite running · {{title}}', { title })
        : translateUi('Waiting on · {{title}}', { title }),
      target,
    };
  }
  return {
    label: translateUi('Waiting on {{count}} tasks', { count: prerequisites.length }),
    target: null,
  };
}

interface WaitingOnLineProps {
  prerequisites: Prerequisite[] | null | undefined;
  /** The task's own due date: a blocked task that is also late turns amber. */
  dueDate?: string | null;
  /** Whether a prerequisite has an agent on it right now. */
  isRunning?: (taskId: string) => boolean;
  /** Opens the one prerequisite the line names. */
  onOpenTask?: (taskId: string) => void;
  className?: string;
}

/**
 * "Waiting on · ‹task›" under a row's title.
 *
 * Grey with a pause mark: being blocked is an order, not a problem. Only a
 * blocked task whose own date has passed takes the warning colour. The
 * prerequisite's name is the one thing on the row that opens a different
 * task, so it is its own button and does not bubble to the row.
 */
export default function WaitingOnLine({
  prerequisites,
  dueDate,
  isRunning,
  onOpenTask,
  className,
}: WaitingOnLineProps) {
  const line = waitingOnLine(prerequisites, isRunning);
  if (!line) return null;
  const late = Boolean(dueDate && isOverdue(dueDate));
  const classes = ['cc-waiting-on', late ? 'cc-waiting-on--late' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  const openTarget = (event: MouseEvent) => {
    event.stopPropagation();
    if (line.target) onOpenTask?.(line.target.id);
  };
  return (
    <small className={classes}>
      <PauseIcon size={10} className="cc-waiting-on__mark" />
      {line.target && onOpenTask ? (
        <button
          type="button"
          className="cc-waiting-on__link"
          onClick={openTarget}
          aria-label={translateUi('Go to {{title}}', { title: line.target.title })}
        >
          {line.label}
        </button>
      ) : (
        <span>{line.label}</span>
      )}
    </small>
  );
}
