import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useToastStore } from '../stores/useToastStore';
import {
  queryKeys,
  useCreateProject,
  useCreateTodo,
  useInboxMove,
  useInboxProjectCandidatesQuery,
  useInboxRoutingsQuery,
  useProjectsQuery,
  useTaskGraphInsightsQuery,
  useTodosQuery,
  type InboxMove,
} from '../hooks/queries';
import { useNoteAction } from '../hooks/queries/useNoteQueries';
import InboxQueue from '../components/inbox/InboxQueue';
import InboxProjectCandidates from '../components/inbox/InboxProjectCandidates';
import InboxCaptureBar from '../components/inbox/InboxCaptureBar';
import { inboxErrorMessage } from '../components/inbox/inboxErrors';
import useInboxGraphRevision from '../hooks/useInboxGraphRevision';
import useInboxPlacement from '../hooks/useInboxPlacement';
import useInboxSections from '../hooks/useInboxSections';
import type { ProjectFolderCandidate } from '../types/schemas';
import { translateUi } from '../i18n';
import { formatMonthDay } from '../utils/formatters';

/**
 * The Inbox files captures by itself. What it just filed shows for a day with
 * an undo; what it was unsure about waits under "Couldn't sort" with two
 * choices. The bar at the bottom adds to the Inbox.
 */
export default function InboxPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { data: todos = [] } = useTodosQuery();
  const { data: projects = [] } = useProjectsQuery();
  const routings = useInboxRoutingsQuery();
  const candidates = useInboxProjectCandidatesQuery();
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
  const createTodo = useCreateTodo();
  const createProject = useCreateProject();

  const review = useMemo(
    () => [
      ...sections.processing,
      ...sections.questioning,
      ...sections.planReady,
      ...sections.errors,
      ...sections.needsOrganising,
    ],
    [sections],
  );
  const processingIds = useMemo(
    () => new Set(sections.processing.map((todo) => todo.id)),
    [sections.processing],
  );

  const runMove = (next: InboxMove) =>
    move.mutateAsync(next).catch((error: unknown) => {
      addToast('error', inboxErrorMessage(error, translateUi('Could not move this item')));
    });
  const runMoves = async (moves: InboxMove[]) => {
    for (const next of moves) await runMove(next);
  };

  const capture = (title: string) =>
    createTodo
      .mutateAsync({ title, source: 'quick_capture', inbox_state: 'classifying' })
      .then((todo) => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.inboxRoutings });
        if (todo?.inbox_state === 'none' && todo.due_date) {
          addToast(
            'success',
            translateUi('Added to tasks, due {{date}}', {
              date: formatMonthDay(todo.due_date),
            }),
          );
        }
        return todo;
      })
      .catch((error: unknown) => {
        addToast('error', inboxErrorMessage(error, translateUi('Could not add to the Inbox')));
        throw error;
      });

  const importCandidate = (candidate: ProjectFolderCandidate) => {
    createProject.mutate(
      { title: candidate.name, description: candidate.folder },
      {
        onSuccess: () =>
          void queryClient.invalidateQueries({ queryKey: queryKeys.inboxProjectCandidates }),
      },
    );
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
          processingIds={processingIds}
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
        <InboxProjectCandidates
          candidates={candidates.data ?? []}
          busy={createProject.isPending}
          onImport={importCandidate}
        />
      </div>
      <InboxCaptureBar busy={createTodo.isPending} onCapture={capture} />
    </div>
  );
}
