import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxTriagePreviewResponse } from '../../types/api';
import useInboxAiTriage from '../useInboxAiTriage';

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  place: vi.fn(),
  undo: vi.fn(),
}));

vi.mock('../queries', () => ({
  usePreviewInboxTriage: () => ({ mutateAsync: mocks.preview, isPending: false }),
  usePlaceTodoGroups: () => ({ mutateAsync: mocks.place, isPending: false }),
  useUndoTodoPlacement: () => ({ mutateAsync: mocks.undo }),
}));

const preview: InboxTriagePreviewResponse = {
  base_graph_revision: 5,
  suggestions: [
    {
      task_id: 'todo-1',
      project_id: 'project-1',
      parent_id: 'todo-root',
      confidence: 0.9,
      reason: 'Matches the project',
    },
  ],
  proposed_workstreams: [],
  unassigned_task_ids: [],
  model_provider: null,
};

describe('useInboxAiTriage', () => {
  beforeEach(() => {
    mocks.preview.mockReset().mockResolvedValue(preview);
    mocks.place.mockReset().mockResolvedValue({ graph_revision: 6, change_set_id: 'change-1' });
    mocks.undo.mockReset();
  });

  it('returns the single destination project after applying', async () => {
    const setPlacementRevision = vi.fn();
    const dropFromBatchSelection = vi.fn();
    const { result } = renderHook(() =>
      useInboxAiTriage({
        placementRevision: 5,
        setPlacementRevision,
        refreshPlacementRevision: vi.fn().mockResolvedValue(undefined),
        batchTaskIds: ['todo-1'],
        dropFromBatchSelection,
      }),
    );

    await act(async () => result.current.requestPreview());
    let destination: string | null = null;
    await act(async () => {
      destination = await result.current.applyPreview();
    });

    expect(destination).toBe('project-1');
    expect(setPlacementRevision).toHaveBeenCalledWith(6);
    expect(dropFromBatchSelection).toHaveBeenCalledWith(new Set(['todo-1']));
  });
});
