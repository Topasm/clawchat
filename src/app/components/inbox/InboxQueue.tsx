import { useMemo, useState, type MouseEvent } from 'react';
import EmptyState from '../shared/EmptyState';
import { InboxTrayIcon } from '../shared/Icons';
import { Pane } from '../shared/WorkspacePrimitives';
import type { ProjectResponse, TodoResponse } from '../../types/api';
import type { InboxRouting } from '../../types/schemas';
import type { InboxMove } from '../../hooks/queries';
import InboxDestinationMenu, { type InboxDestinationOption } from './InboxDestinationMenu';
import { translateUi } from '../../i18n';
import { formatMonthDay } from '../../utils/formatters';

interface InboxQueueProps {
  /** What the Inbox filed in the last day, newest first. */
  routings: InboxRouting[];
  /** Captures that still wait for the user: unsure, failed, or from before auto-organize. */
  review: TodoResponse[];
  /** Captures the classifier is still reading; they are not failures yet. */
  processing: TodoResponse[];
  projects: ProjectResponse[];
  todoById: Map<string, TodoResponse>;
  busy: boolean;
  onMove: (move: InboxMove) => void;
  onMoveMany: (moves: InboxMove[]) => void;
  onPlaceInProject: (todoId: string, projectId: string) => void;
  onMoveNote: (noteId: string, projectId: string | null) => void;
  onOpenTask: (todoId: string) => void;
  onOpenNotes: () => void;
}

/** Below this the Inbox filed the item anyway and marks it for a look. */
const LOW_CONFIDENCE = 0.8;

function folderName(folder: string | null): string | null {
  if (!folder) return null;
  return folder.split('/').filter(Boolean).pop() ?? null;
}

/**
 * The Inbox: what it just organized by itself, and the few captures it was not
 * sure about. A row's destination opens a small menu; Shift- or Cmd-click
 * selects rows under "Couldn't sort" to file several at once.
 */
export default function InboxQueue({
  routings,
  review,
  processing,
  projects,
  todoById,
  busy,
  onMove,
  onMoveMany,
  onPlaceInProject,
  onMoveNote,
  onOpenTask,
  onOpenNotes,
}: InboxQueueProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const reviewIds = useMemo(() => new Set(review.map((todo) => todo.id)), [review]);
  const selection = selected.filter((id) => reviewIds.has(id));
  const projectTitle = (projectId: string | null | undefined) =>
    projects.find((project) => project.id === projectId)?.title ?? null;

  const destinationOptions = (routing: InboxRouting): InboxDestinationOption[] => {
    const isTask = routing.kind === 'task';
    const options: InboxDestinationOption[] = [
      {
        key: 'task',
        label: translateUi('Task'),
        current: isTask,
        onSelect: () => routing.note_id && onMove({ action: 'to-task', noteId: routing.note_id }),
      },
      {
        key: 'note',
        label: translateUi('Note'),
        current: !isTask,
        onSelect: () => routing.todo_id && onMove({ action: 'to-note', todoId: routing.todo_id }),
      },
    ];
    for (const project of projects) {
      options.push({
        key: `project:${project.id}`,
        label: translateUi('Project · {{title}}', { title: project.title }),
        current: isTask && todoById.get(routing.todo_id ?? '')?.project_id === project.id,
        onSelect: () => {
          if (isTask && routing.todo_id) onPlaceInProject(routing.todo_id, project.id);
          else if (routing.note_id) onMoveNote(routing.note_id, project.id);
        },
      });
    }
    return options;
  };

  const destinationDetail = (routing: InboxRouting): string => {
    const parts: string[] = [];
    if (routing.kind === 'task') {
      if (routing.due_date) {
        parts.push(translateUi('Due {{date}}', { date: formatMonthDay(routing.due_date) }));
      }
      const place =
        projectTitle(todoById.get(routing.todo_id ?? '')?.project_id) ??
        folderName(routing.project_folder);
      if (place) parts.push(place);
    }
    return parts.join(' · ');
  };

  const toggle = (todoId: string) =>
    setSelected((current) =>
      current.includes(todoId) ? current.filter((id) => id !== todoId) : [...current, todoId],
    );
  const openOrSelect = (event: MouseEvent, todoId: string) => {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggle(todoId);
      return;
    }
    if (selection.length > 0) {
      toggle(todoId);
      return;
    }
    onOpenTask(todoId);
  };
  const fileSelection = (action: 'file-as-task' | 'to-note') => {
    onMoveMany(selection.map((todoId) => ({ action, todoId })));
    setSelected([]);
  };

  const empty = routings.length === 0 && review.length === 0 && processing.length === 0;

  return (
    <Pane as="main" className="cc-inbox-queue">
      {routings.length > 0 && (
        <section className="cc-inbox-section" aria-labelledby="cc-inbox-organized">
          <h2 className="cc-inbox-section__title" id="cc-inbox-organized">
            {translateUi('Just organized')}
            <span className="cc-inbox-section__count">{routings.length}</span>
          </h2>
          <ul className="cc-inbox-list">
            {routings.map((routing) => {
              const detail = destinationDetail(routing);
              return (
                <li key={routing.id} className="cc-inbox-row">
                  <button
                    type="button"
                    className={`cc-inbox-row__title${
                      routing.kind_confidence != null && routing.kind_confidence < LOW_CONFIDENCE
                        ? ' cc-inbox-row__title--unsure'
                        : ''
                    }`}
                    title={
                      routing.kind_confidence != null && routing.kind_confidence < LOW_CONFIDENCE
                        ? translateUi('Filed with low confidence. Check where it went.')
                        : undefined
                    }
                    onClick={() =>
                      routing.kind === 'task' && routing.todo_id
                        ? onOpenTask(routing.todo_id)
                        : onOpenNotes()
                    }
                  >
                    {routing.title}
                  </button>
                  <InboxDestinationMenu options={destinationOptions(routing)} disabled={busy}>
                    <span className={`cc-inbox-kind cc-inbox-kind--${routing.kind}`}>
                      {routing.kind === 'task' ? translateUi('Task') : translateUi('Note')}
                    </span>
                    {detail && <span className="cc-inbox-row__detail">{detail}</span>}
                  </InboxDestinationMenu>
                  <button
                    type="button"
                    className="cc-inbox-row__undo"
                    disabled={busy}
                    onClick={() => onMove({ action: 'undo', routingId: routing.id })}
                  >
                    {translateUi('Undo')}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {processing.length > 0 && (
        <section className="cc-inbox-section" aria-labelledby="cc-inbox-organizing">
          <h2 className="cc-inbox-section__title" id="cc-inbox-organizing">
            {translateUi('Organizing')}
            <span className="cc-inbox-section__count">{processing.length}</span>
          </h2>
          <ul className="cc-inbox-list">
            {processing.map((todo) => (
              <li key={todo.id} className="cc-inbox-row">
                <button
                  type="button"
                  className="cc-inbox-row__title"
                  onClick={() => onOpenTask(todo.id)}
                >
                  {todo.title}
                </button>
                <span className="cc-inbox-row__detail">{translateUi('Organizing…')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(review.length > 0 || routings.length > 0) && (
        <section className="cc-inbox-section" aria-labelledby="cc-inbox-review">
          <h2 className="cc-inbox-section__title" id="cc-inbox-review">
            {translateUi("Couldn't sort")}
            <span className="cc-inbox-section__count">{review.length}</span>
          </h2>
          {selection.length > 0 && (
            <div className="cc-inbox-selection" role="toolbar" aria-label={translateUi('Selected')}>
              <span>{translateUi('{{count}} selected', { count: selection.length })}</span>
              <button
                type="button"
                className="cc-btn cc-btn--compact"
                disabled={busy}
                onClick={() => fileSelection('file-as-task')}
              >
                {translateUi('Task')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--compact"
                disabled={busy}
                onClick={() => fileSelection('to-note')}
              >
                {translateUi('Note')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--compact cc-btn--ghost"
                onClick={() => setSelected(review.map((t) => t.id))}
              >
                {translateUi('Select all')}
              </button>
              <button
                type="button"
                className="cc-btn cc-btn--compact cc-btn--ghost"
                onClick={() => setSelected([])}
              >
                {translateUi('Cancel')}
              </button>
            </div>
          )}
          {review.length === 0 ? (
            <p className="cc-inbox-section__empty">{translateUi('Nothing to check')}</p>
          ) : (
            <ul className="cc-inbox-list">
              {review.map((todo) => {
                const isSelected = selection.includes(todo.id);
                return (
                  <li
                    key={todo.id}
                    className={`cc-inbox-row${isSelected ? ' cc-inbox-row--selected' : ''}`}
                    aria-selected={selection.length > 0 ? isSelected : undefined}
                  >
                    <button
                      type="button"
                      className="cc-inbox-row__title"
                      onClick={(event) => openOrSelect(event, todo.id)}
                    >
                      {todo.title}
                    </button>
                    {selection.length === 0 && (
                      <span className="cc-inbox-row__choices">
                        <button
                          type="button"
                          className="cc-btn cc-btn--compact"
                          disabled={busy}
                          onClick={() => onMove({ action: 'file-as-task', todoId: todo.id })}
                        >
                          {translateUi('Task')}
                        </button>
                        <button
                          type="button"
                          className="cc-btn cc-btn--compact"
                          disabled={busy}
                          onClick={() => onMove({ action: 'to-note', todoId: todo.id })}
                        >
                          {translateUi('Note')}
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {empty && (
        <EmptyState
          icon={<InboxTrayIcon size={20} />}
          message={translateUi('Inbox is clear. Write a task or a note below.')}
        />
      )}
    </Pane>
  );
}
