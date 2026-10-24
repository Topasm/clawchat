import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToastStore } from '../stores/useToastStore';
import {
  useInboxMove,
  useInboxRoutingsQuery,
  useProjectsQuery,
  useTaskGraphInsightsQuery,
  useTodosQuery,
  type InboxMove,
} from '../hooks/queries';
import { useNoteAction } from '../hooks/queries/useNoteQueries';
import InboxQueue from '../components/inbox/InboxQueue';
import InboxCaptureBar from '../components/inbox/InboxCaptureBar';
import { inboxErrorMessage, undoErrorMessage } from '../components/inbox/inboxErrors';
import useInboxGraphRevision from '../hooks/useInboxGraphRevision';
import useInboxPlacement from '../hooks/useInboxPlacement';
import useInboxSections from '../hooks/useInboxSections';
import { translateUi } from '../i18n';
import useInboxCapture from '../hooks/useInboxCapture';

/**
 * The Inbox files captures by itself. What it just filed shows for a day with
 * an undo; what it was unsure about waits under "Couldn't sort" with two
 * choices. The bar at the bottom adds to the Inbox.
 */
export default function InboxPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const { data: todos = [] } = useTodosQuery();
  const { data: projects = [] } = useProjectsQuery();
  const routings = useInboxRoutingsQuery();
  const graphInsights = useTaskGraphInsightsQuery(null);
  const { placementRevision, setPlacementRevision } = useInboxGraphRevision(graphInsights);
  const placement = useInboxPlacement({
    todos,
    placementRevision,
    setPlacementRevision,
    onBeforePlacement: () => undefined,
    onBatchPlaced: () => undefined,
  });
  const sections = useInboxSections(todos);
  const move = useInboxMove();
  const noteAction = useNoteAction();
  const { capture, busy: capturing } = useInboxCapture();

  const review = useMemo(
    () => [
      ...sections.questioning,
      ...sections.planReady,
      ...sections.errors,
      ...sections.needsOrganising,
    ],
    [sections],
  );

  const runMove = (next: InboxMove) =>
    move.mutateAsync(next).then(
      (routing) => {
        // An undo is otherwise silent: the row leaves "Just organized" and the
        // item is back as a capture (or a note), so say where it went.
        if (next.action !== 'undo') return;
        const title = routing.original_title || routing.title;
        addToast(
          'success',
          routing.kind === 'task' && routing.note_id
            ? translateUi('Undone. “{{title}}” is a note again', { title })
            : translateUi('Undone. “{{title}}” is back in the Inbox', { title }),
        );
      },
      (error: unknown) => {
        addToast(
          'error',
          next.action === 'undo'
            ? undoErrorMessage(error)
            : inboxErrorMessage(error, translateUi('Could not move this item')),
        );
      },
    );
  const runMoves = async (moves: InboxMove[]) => {
    for (const next of moves) await runMove(next);
  };

  const busy = move.isPending || noteAction.isPending || placement.isPlacing;

  return (
    <div className="cc-inbox-page">
      <div className="cc-page-header cc-inbox-page__header">
        <div className="cc-page-header__title">{translateUi('Inbox')}</div>
      </div>
      <div className="cc-inbox-layout">
        <InboxQueue
          routings={routings.data?.items ?? []}
          review={review}
          processing={sections.processing}
          projects={projects}
          todoById={sections.todoById}
          busy={busy}
          onMove={(next) => void runMove(next)}
          onMoveMany={(moves) => void runMoves(moves)}
          onPlaceInProject={(todoId, projectId) =>
            void placement.placeTask(todoId, projectId, null)
          }
          onMoveNote={(noteId, projectId) =>
            noteAction.mutate({ action: 'move', id: noteId, project_id: projectId })
          }
          onOpenTask={(todoId) => navigate(`/tasks/${todoId}`)}
          onOpenNotes={() => navigate('/notes')}
        />
      </div>
      <InboxCaptureBar busy={capturing} onCapture={capture} />
    </div>
  );
}
