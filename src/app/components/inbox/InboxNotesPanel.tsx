import { useEffect, useRef, useState } from 'react';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import { useNoteAction, useNotesQuery, type Note } from '../../hooks/queries/useNoteQueries';
import { translateUi } from '../../i18n';
import { useAuthStore } from '../../stores/useAuthStore';

interface Props {
  projects: { id: string; title: string }[];
  projectId?: string;
}
export default function InboxNotesPanel(props: Props) {
  const server = useAuthStore((s) => s.serverUrl);
  return <NotesContent key={`${server}:${props.projectId ?? 'inbox'}`} {...props} />;
}

function NotesContent({ projects, projectId }: Props) {
  const query = useNotesQuery();
  const mutation = useNoteAction();
  const [filter, setFilter] = useState<string | null>(projectId ?? null);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [editText, setEditText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [undo, setUndo] = useState<{ id: string; project_id: string | null } | null>(null);
  const key = useRef(crypto.randomUUID());
  const editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);
  const notes = query.data ?? [];
  const currentFilter = filter && projects.some((p) => p.id === filter) ? filter : null;
  const visible = notes.filter((n) => n.project_id === currentFilter);
  const destinations = [{ id: '', title: translateUi('Inbox') }, ...projects];

  const move = (id: string, destination: string | null) => {
    if (mutation.isPending) return;
    const note = notes.find((n) => n.id === id);
    if (!note || note.project_id === destination) return;
    mutation.mutate(
      { action: 'move', id, project_id: destination },
      {
        onSuccess: () => setUndo({ id, project_id: note.project_id }),
      },
    );
  };
  const drop = (result: DropResult) => {
    if (!result.destination?.droppableId.startsWith('note-project:')) return;
    move(result.draggableId, result.destination.droppableId.slice('note-project:'.length) || null);
  };

  return (
    <section className="cc-notes" aria-label={translateUi('Notes')}>
      <p className="cc-notes__hint">
        {translateUi('Long-press a note and drop it on a project. Tap a project to see its notes.')}
      </p>
      <DragDropContext onDragEnd={drop}>
        <div className="cc-notes__projects">
          {destinations.map((project) => (
            <Droppable
              key={project.id}
              droppableId={`note-project:${project.id}`}
              isDropDisabled={mutation.isPending}
            >
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`cc-notes__target ${snapshot.isDraggingOver ? 'is-over' : ''}`}
                >
                  <button
                    type="button"
                    className="cc-btn"
                    aria-pressed={currentFilter === (project.id || null)}
                    disabled={mutation.isPending}
                    onClick={() => {
                      setFilter(project.id || null);
                      key.current = crypto.randomUUID();
                    }}
                  >
                    {project.title}{' '}
                    <span>{notes.filter((n) => n.project_id === (project.id || null)).length}</span>
                  </button>
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
        <form
          className="cc-notes__composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim() || mutation.isPending) return;
            mutation.mutate(
              {
                action: 'create',
                content: draft.trim(),
                project_id: currentFilter,
                idempotency_key: key.current,
              },
              {
                onSuccess: () => {
                  setDraft('');
                  key.current = crypto.randomUUID();
                },
              },
            );
          }}
        >
          <textarea
            aria-label={translateUi('Write a note')}
            placeholder={translateUi('Write a thought, reference, or idea…')}
            rows={3}
            maxLength={20000}
            value={draft}
            disabled={mutation.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              key.current = crypto.randomUUID();
            }}
          />
          <button className="cc-btn cc-btn--primary" disabled={mutation.isPending || !draft.trim()}>
            {translateUi('Save note')}
          </button>
        </form>
        {(query.isError || mutation.isError) && (
          <p role="alert">
            {translateUi('Could not save or load notes. Your text is still here. Try again.')}
            <button
              type="button"
              className="cc-btn"
              onClick={() => {
                void query.refetch();
              }}
            >
              {translateUi('Refresh')}
            </button>
          </p>
        )}
        {undo && (
          <div role="status">
            {translateUi('Note moved')}{' '}
            <button
              className="cc-btn"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.mutate({ action: 'move', ...undo }, { onSuccess: () => setUndo(null) });
              }}
            >
              {translateUi('Undo move')}
            </button>
          </div>
        )}
        <Droppable droppableId="notes-list">
          {(provided) => (
            <div className="cc-notes__list" ref={provided.innerRef} {...provided.droppableProps}>
              {query.isLoading && <p>{translateUi('Loading...')}</p>}
              {!query.isLoading && !query.isError && visible.length === 0 && (
                <p>{translateUi('No notes here yet')}</p>
              )}
              {visible.map((note, index) => (
                <Draggable
                  key={note.id}
                  draggableId={note.id}
                  index={index}
                  isDragDisabled={mutation.isPending}
                >
                  {(drag) => (
                    <article
                      className="cc-notes__card"
                      ref={drag.innerRef}
                      {...drag.draggableProps}
                    >
                      <div
                        className="cc-notes__body"
                        {...drag.dragHandleProps}
                        aria-label={translateUi('Move note')}
                      >
                        <strong>{note.content.split('\n')[0]}</strong>
                        <p>{note.content.split('\n').slice(1).join('\n')}</p>
                      </div>
                      <div className="cc-notes__actions">
                        <button
                          className="cc-btn"
                          disabled={mutation.isPending}
                          onClick={() => {
                            setEditing(note);
                            setEditText(note.content);
                            setConfirmDelete(false);
                          }}
                        >
                          {translateUi('Edit note')}
                        </button>
                        <select
                          aria-label={translateUi('Move to project')}
                          value={note.project_id ?? ''}
                          disabled={mutation.isPending}
                          onChange={(event) => move(note.id, event.target.value || null)}
                        >
                          {destinations.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </div>
                    </article>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      {editing && (
        <div className="cc-notes__editor" role="region" aria-label={translateUi('Edit note')}>
          <textarea
            ref={editor}
            aria-label={translateUi('Note content')}
            value={editText}
            maxLength={20000}
            rows={8}
            disabled={mutation.isPending}
            onChange={(event) => setEditText(event.target.value)}
          />
          <div className="cc-notes__actions">
            <button
              className="cc-btn cc-btn--primary"
              disabled={mutation.isPending || !editText.trim()}
              onClick={() =>
                mutation.mutate(
                  { action: 'edit', id: editing.id, content: editText.trim() },
                  { onSuccess: () => setEditing(null) },
                )
              }
            >
              {translateUi('Save')}
            </button>
            <button
              className="cc-btn"
              disabled={mutation.isPending}
              onClick={() => setEditing(null)}
            >
              {translateUi('Cancel')}
            </button>
            <button
              className="cc-btn"
              disabled={mutation.isPending}
              onClick={() => setConfirmDelete(true)}
            >
              {translateUi('Delete note')}
            </button>
          </div>
          {confirmDelete && (
            <p>
              {translateUi('Delete this note?')}{' '}
              <button
                className="cc-btn"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate(
                    { action: 'delete', id: editing.id },
                    {
                      onSuccess: () => {
                        setEditing(null);
                        setUndo(null);
                      },
                    },
                  )
                }
              >
                {translateUi('Delete')}
              </button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
