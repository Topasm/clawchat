import { usePlaceTodo, usePlaceTodosBatch, useUndoTodoPlacement } from './queries';
import { useToastStore } from '../stores/useToastStore';
import type { TodoResponse } from '../types/api';
import { inboxErrorMessage, undoErrorMessage } from '../components/inbox/inboxErrors';
import { translateUi } from '../i18n';
interface PlacementImpact {
  ready_count: number;
  blocked_count: number;
}
interface InboxPlacementOptions {
  todos: TodoResponse[];
  placementRevision: number | null;
  setPlacementRevision: (revision: number) => void;
  /** Runs before every placement so a stale AI preview never survives a manual move. */
  onBeforePlacement: () => void;
  /** Runs after a batch lands so the moved tasks leave the batch selection. */
  onBatchPlaced: () => void;
}
export interface InboxPlacement {
  isPlacing: boolean;
  isBatchPlacing: boolean;
  placeTask: (
    taskId: string,
    projectId: string | null,
    parentId: string | null,
    beforeId?: string,
  ) => Promise<void>;
  placeTaskBatch: (
    taskIds: string[],
    projectId: string | null,
    parentId: string | null,
    beforeId?: string,
  ) => Promise<void>;
}
function impactLabel(impact: PlacementImpact | null | undefined): string {
  if (!impact) return '';
  const ready = `${impact.ready_count >= 0 ? '+' : ''}${impact.ready_count}`;
  const blocked = `${impact.blocked_count >= 0 ? '+' : ''}${impact.blocked_count}`;
  return ` · Ready ${ready} · Blocked ${blocked}`;
}
/** Owns the single and batch placement commands, including their undo affordance. */
export default function useInboxPlacement({
  todos,
  placementRevision,
  setPlacementRevision,
  onBeforePlacement,
  onBatchPlaced,
}: InboxPlacementOptions): InboxPlacement {
  const addToast = useToastStore((s) => s.addToast);
  const placeMutation = usePlaceTodo();
  const placeBatchMutation = usePlaceTodosBatch();
  const undoPlacement = useUndoTodoPlacement();
  const undoAction = (changeSetId: string, undoneMessage: string, failureMessage: string) => ({
    label: translateUi('Undo'),
    onClick: () => {
      void undoPlacement
        .mutateAsync(changeSetId)
        .then((undone) => {
          setPlacementRevision(undone.graph_revision);
          addToast('info', undoneMessage);
        })
        .catch((error: unknown) => {
          addToast('error', undoErrorMessage(error, failureMessage));
        });
    },
  });
  const placeTask = async (
    taskId: string,
    projectId: string | null,
    parentId: string | null,
    beforeId?: string,
  ) => {
    if (placementRevision == null) {
      addToast('warning', translateUi('The current graph revision is still loading'));
      return;
    }
    onBeforePlacement();
    try {
      const moved = todos.find((todo) => todo.id === taskId);
      const nextInboxState =
        projectId === null
          ? 'captured'
          : moved?.inbox_state && !['none', 'captured'].includes(moved.inbox_state)
            ? moved.inbox_state
            : 'none';
      const result = await placeMutation.mutateAsync({
        id: taskId,
        placement: {
          project_id: projectId,
          parent_id: parentId,
          before_id: beforeId ?? null,
          inbox_state: nextInboxState,
          expected_graph_revision: placementRevision,
        },
      });
      setPlacementRevision(result.graph_revision);
      addToast(
        'success',
        translateUi('Moved “{{title}}”{{impact}}', {
          title: moved?.title ?? translateUi('Task'),
          impact: impactLabel(result.insights_delta),
        }),
        {
          duration: 6000,
          action: undoAction(
            result.change_set_id,
            'Placement reverted',
            'Could not undo placement',
          ),
        },
      );
    } catch (error) {
      addToast('error', inboxErrorMessage(error, translateUi('Could not place this task')));
    }
  };
  const placeTaskBatch = async (
    taskIds: string[],
    projectId: string | null,
    parentId: string | null,
    beforeId?: string,
  ) => {
    if (placementRevision == null) {
      addToast('warning', translateUi('The current graph revision is still loading'));
      return;
    }
    onBeforePlacement();
    try {
      const result = await placeBatchMutation.mutateAsync({
        todo_ids: taskIds,
        project_id: projectId,
        parent_id: parentId,
        before_id: beforeId ?? null,
        inbox_state: projectId === null ? 'captured' : 'none',
        expected_graph_revision: placementRevision,
      });
      setPlacementRevision(result.graph_revision);
      onBatchPlaced();
      addToast(
        'success',
        translateUi('Moved {{count}} tasks{{impact}}', {
          count: taskIds.length,
          impact: impactLabel(result.insights_delta),
        }),
        {
          duration: 6000,
          action: undoAction(
            result.change_set_id,
            `${taskIds.length} task placements reverted`,
            'Could not undo batch placement',
          ),
        },
      );
    } catch (error) {
      addToast('error', inboxErrorMessage(error, translateUi('Could not place these tasks')));
    }
  };
  return {
    isPlacing: placeMutation.isPending,
    isBatchPlacing: placeBatchMutation.isPending,
    placeTask,
    placeTaskBatch,
  };
}
