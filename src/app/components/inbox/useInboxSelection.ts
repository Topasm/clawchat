import { useCallback, useMemo, useState } from 'react';

import type { TodoResponse } from '../../types/api';

export interface InboxSelection {
  /** The task the inspector and the tree act on. */
  selectedTaskId: string | null;
  selectTask: (taskId: string | null) => void;
  /** The captured tasks queued for one atomic multi-task placement. */
  batchTaskIds: string[];
  toggleBatchTask: (taskId: string) => void;
  selectAllForBatch: () => void;
  clearBatchSelection: () => void;
  dropFromBatchSelection: (taskIds: ReadonlySet<string>) => void;
}

/** Owns which Inbox task is inspected and which ones travel together in a batch. */
export default function useInboxSelection(needsOrganising: TodoResponse[]): InboxSelection {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedInboxTaskIds, setSelectedInboxTaskIds] = useState<string[]>([]);

  const batchTaskIds = useMemo(
    () =>
      needsOrganising
        .filter((todo) => selectedInboxTaskIds.includes(todo.id))
        .map((todo) => todo.id),
    [needsOrganising, selectedInboxTaskIds],
  );

  const toggleBatchTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setSelectedInboxTaskIds((current) =>
      current.includes(taskId)
        ? current.filter((selectedId) => selectedId !== taskId)
        : [...current, taskId],
    );
  }, []);

  const selectAllForBatch = useCallback(() => {
    setSelectedInboxTaskIds(needsOrganising.map((todo) => todo.id));
    setSelectedTaskId(needsOrganising[0]?.id ?? null);
  }, [needsOrganising]);

  const clearBatchSelection = useCallback(() => setSelectedInboxTaskIds([]), []);

  const dropFromBatchSelection = useCallback((taskIds: ReadonlySet<string>) => {
    setSelectedInboxTaskIds((current) => current.filter((taskId) => !taskIds.has(taskId)));
  }, []);

  return {
    selectedTaskId,
    selectTask: setSelectedTaskId,
    batchTaskIds,
    toggleBatchTask,
    selectAllForBatch,
    clearBatchSelection,
    dropFromBatchSelection,
  };
}
