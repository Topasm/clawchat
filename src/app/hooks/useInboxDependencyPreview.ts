import { useEffect, useState } from 'react';
import { useCreateTaskDependency, usePreviewTaskDependency } from './queries';
import { useToastStore } from '../stores/useToastStore';
import type { TaskDependencyPreviewResponse, TodoResponse } from '../types/api';
import { dependencyErrorMessage, isGraphRevisionConflict } from '../components/inbox/inboxErrors';
import { translateUi } from '../i18n';
interface InboxDependencyPreviewOptions {
  todoById: ReadonlyMap<string, TodoResponse>;
  selectedTaskId: string | null;
  selectTask: (taskId: string | null) => void;
  placementRevision: number | null;
  setPlacementRevision: (revision: number) => void;
  refreshPlacementRevision: () => Promise<void>;
}
export interface InboxDependencyPreview {
  preview: TaskDependencyPreviewResponse | null;
  isPreviewing: boolean;
  isCreating: boolean;
  requestPreview: (dependentTaskId: string, prerequisiteTaskId: string) => Promise<void>;
  confirmPreview: () => Promise<void>;
  dismissPreview: () => void;
}
/**
 * Owns the two-step "must wait for" flow. The preview belongs to the selected task,
 * so it is dropped as soon as the selection moves elsewhere.
 */
export default function useInboxDependencyPreview({
  todoById,
  selectedTaskId,
  selectTask,
  placementRevision,
  setPlacementRevision,
  refreshPlacementRevision,
}: InboxDependencyPreviewOptions): InboxDependencyPreview {
  const addToast = useToastStore((s) => s.addToast);
  const previewDependency = usePreviewTaskDependency();
  const createDependency = useCreateTaskDependency();
  const [dependencyPreview, setDependencyPreview] = useState<TaskDependencyPreviewResponse | null>(
    null,
  );
  useEffect(() => {
    if (dependencyPreview && dependencyPreview.dependent_task_id !== selectedTaskId) {
      setDependencyPreview(null);
    }
  }, [dependencyPreview, selectedTaskId]);
  const recoverFromConflict = async (error: unknown) => {
    if (isGraphRevisionConflict(error)) {
      await refreshPlacementRevision();
    }
  };
  const requestPreview = async (dependentTaskId: string, prerequisiteTaskId: string) => {
    if (placementRevision == null) {
      addToast('warning', translateUi('The current graph revision is still loading'));
      return;
    }
    selectTask(dependentTaskId);
    try {
      const result = await previewDependency.mutateAsync({
        dependent_task_id: dependentTaskId,
        prerequisite_task_id: prerequisiteTaskId,
        expected_graph_revision: placementRevision,
      });
      setDependencyPreview(result);
    } catch (error) {
      setDependencyPreview(null);
      addToast('error', dependencyErrorMessage(error, todoById));
      await recoverFromConflict(error);
    }
  };
  const confirmPreview = async () => {
    if (!dependencyPreview) return;
    try {
      const result = await createDependency.mutateAsync({
        dependent_task_id: dependencyPreview.dependent_task_id,
        prerequisite_task_id: dependencyPreview.prerequisite_task_id,
        expected_graph_revision: dependencyPreview.base_graph_revision,
      });
      const dependent = todoById.get(result.dependent_task_id)?.title ?? 'Task';
      const prerequisite = todoById.get(result.prerequisite_task_id)?.title ?? 'prerequisite';
      setPlacementRevision(result.graph_revision);
      setDependencyPreview(null);
      addToast(
        'success',
        translateUi('“{{dependent}}” now waits for “{{prerequisite}}”', {
          dependent,
          prerequisite,
        }),
      );
    } catch (error) {
      setDependencyPreview(null);
      addToast('error', dependencyErrorMessage(error, todoById));
      await recoverFromConflict(error);
    }
  };
  return {
    preview: dependencyPreview,
    isPreviewing: previewDependency.isPending,
    isCreating: createDependency.isPending,
    requestPreview,
    confirmPreview,
    dismissPreview: () => setDependencyPreview(null),
  };
}
