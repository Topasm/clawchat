import { useEffect, useState } from 'react';
import { usePlaceTodoGroups, usePreviewInboxTriage, useUndoTodoPlacement } from './queries';
import { useToastStore } from '../stores/useToastStore';
import type { InboxTriagePreviewResponse } from '../types/api';
import { buildInboxTriagePlacementGroups } from '../utils/inboxTriage';
import { inboxErrorMessage, isGraphRevisionConflict } from '../components/inbox/inboxErrors';
import { translateUi } from '../i18n';
interface InboxAiTriageOptions {
  placementRevision: number | null;
  setPlacementRevision: (revision: number) => void;
  refreshPlacementRevision: () => Promise<void>;
  batchTaskIds: string[];
  dropFromBatchSelection: (taskIds: ReadonlySet<string>) => void;
}
export interface InboxAiTriage {
  preview: InboxTriagePreviewResponse | null;
  selectedTaskIds: string[];
  isSuggesting: boolean;
  isApplying: boolean;
  requestPreview: () => Promise<void>;
  applyPreview: () => Promise<string | null>;
  toggleSuggestion: (taskId: string) => void;
  dismissPreview: () => void;
}
/**
 * Owns the AI placement suggestion round-trip: preview, per-suggestion selection,
 * and the grouped apply. The preview is dropped whenever the graph moves under it.
 */
export default function useInboxAiTriage({
  placementRevision,
  setPlacementRevision,
  refreshPlacementRevision,
  batchTaskIds,
  dropFromBatchSelection,
}: InboxAiTriageOptions): InboxAiTriage {
  const addToast = useToastStore((s) => s.addToast);
  const triagePreviewMutation = usePreviewInboxTriage();
  const placeGroupsMutation = usePlaceTodoGroups();
  const undoPlacement = useUndoTodoPlacement();
  const [triagePreview, setTriagePreview] = useState<InboxTriagePreviewResponse | null>(null);
  const [selectedTriageTaskIds, setSelectedTriageTaskIds] = useState<string[]>([]);
  useEffect(() => {
    if (triagePreview && placementRevision !== triagePreview.base_graph_revision) {
      setTriagePreview(null);
      setSelectedTriageTaskIds([]);
    }
  }, [placementRevision, triagePreview]);
  const dismissPreview = () => {
    setTriagePreview(null);
    setSelectedTriageTaskIds([]);
  };
  const toggleSuggestion = (taskId: string) => {
    setSelectedTriageTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((selectedId) => selectedId !== taskId)
        : [...current, taskId],
    );
  };
  const requestPreview = async () => {
    if (placementRevision == null || batchTaskIds.length === 0) {
      addToast(
        'warning',
        translateUi('Select Inbox tasks after the graph revision finishes loading'),
      );
      return;
    }
    try {
      const preview = await triagePreviewMutation.mutateAsync({
        todo_ids: batchTaskIds,
        expected_graph_revision: placementRevision,
      });
      setTriagePreview(preview);
      setSelectedTriageTaskIds(preview.suggestions.map((suggestion) => suggestion.task_id));
      if (preview.suggestions.length === 0) {
        addToast('info', translateUi('AI could not confidently place the selected tasks'));
      }
    } catch (error) {
      setTriagePreview(null);
      setSelectedTriageTaskIds([]);
      addToast(
        'error',
        inboxErrorMessage(error, translateUi('Could not generate placement suggestions')),
      );
      if (isGraphRevisionConflict(error)) {
        await refreshPlacementRevision();
      }
    }
  };
  const applyPreview = async () => {
    if (!triagePreview) return null;
    const selected = new Set(selectedTriageTaskIds);
    const suggestions = triagePreview.suggestions.filter((suggestion) =>
      selected.has(suggestion.task_id),
    );
    if (suggestions.length === 0) {
      addToast('warning', translateUi('Select at least one suggestion to apply'));
      return null;
    }
    const projectIds = new Set(suggestions.map((suggestion) => suggestion.project_id));
    const singleProjectId = projectIds.size === 1 ? [...projectIds][0] : null;
    let groups;
    try {
      groups = buildInboxTriagePlacementGroups(triagePreview, selectedTriageTaskIds);
    } catch (error) {
      addToast(
        'error',
        error instanceof Error ? error.message : translateUi('The placement preview is invalid'),
      );
      return null;
    }
    try {
      const result = await placeGroupsMutation.mutateAsync({
        groups,
        expected_graph_revision: triagePreview.base_graph_revision,
      });
      const appliedIds = new Set(suggestions.map((suggestion) => suggestion.task_id));
      setPlacementRevision(result.graph_revision);
      dropFromBatchSelection(appliedIds);
      setTriagePreview(null);
      setSelectedTriageTaskIds([]);
      addToast(
        'success',
        translateUi('Applied {{count}} AI placement suggestions', { count: suggestions.length }),
        {
          duration: 6000,
          action: {
            label: translateUi('Undo'),
            onClick: () => {
              void undoPlacement
                .mutateAsync(result.change_set_id)
                .then((undone) => {
                  setPlacementRevision(undone.graph_revision);
                  addToast('info', translateUi('AI placements reverted'));
                })
                .catch((error: unknown) => {
                  addToast(
                    'error',
                    inboxErrorMessage(error, translateUi('Could not undo AI placements')),
                  );
                });
            },
          },
        },
      );
      return singleProjectId;
    } catch (error) {
      addToast(
        'error',
        inboxErrorMessage(error, translateUi('Could not apply placement suggestions')),
      );
      if (isGraphRevisionConflict(error)) {
        setTriagePreview(null);
        setSelectedTriageTaskIds([]);
        await refreshPlacementRevision();
      }
      return null;
    }
  };
  return {
    preview: triagePreview,
    selectedTaskIds: selectedTriageTaskIds,
    isSuggesting: triagePreviewMutation.isPending,
    isApplying: placeGroupsMutation.isPending,
    requestPreview,
    applyPreview,
    toggleSuggestion,
    dismissPreview,
  };
}
