import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxTriagePreviewResponse } from '../../types/api';
import useInboxAiTriage, { type AppliedInboxPlacement } from '../useInboxAiTriage';
import { useToastStore } from '../../stores/useToastStore';

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
    useToastStore.setState({ toasts: [] });
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
    let destination: AppliedInboxPlacement | null = null;
    await act(async () => {
      destination = await result.current.applyPreview();
    });

    expect(destination).toEqual({
      projectId: 'project-1',
      taskId: 'todo-1',
      count: 1,
      changeSetId: 'change-1',
    });
    expect(result.current.applied).toEqual(destination);
    expect(setPlacementRevision).toHaveBeenCalledWith(6);
    expect(dropFromBatchSelection).toHaveBeenCalledWith(new Set(['todo-1']));
  });

  function renderTriage() {
    return renderHook(() =>
      useInboxAiTriage({
        placementRevision: 5,
        setPlacementRevision: vi.fn(),
        refreshPlacementRevision: vi.fn(),
        batchTaskIds: ['todo-1'],
        dropFromBatchSelection: vi.fn(),
      }),
    );
  }

  it('does not invent a destination after failure', async () => {
    mocks.place.mockRejectedValue(new Error('Offline'));
    const { result } = renderTriage();
    await act(async () => result.current.requestPreview());
    await act(async () => {
      expect(await result.current.applyPreview()).toBeNull();
    });
    expect(result.current.applied).toBeNull();
    expect(result.current.preview).not.toBeNull();
  });

  it('does not choose an arbitrary project for a mixed batch', async () => {
    mocks.preview.mockResolvedValue({
      ...preview,
      suggestions: [
        preview.suggestions[0],
        { ...preview.suggestions[0], task_id: 'todo-2', project_id: 'project-2', parent_id: null },
      ],
    });
    const { result } = renderTriage();
    await act(async () => result.current.requestPreview());
    await act(async () => {
      await result.current.applyPreview();
    });
    expect(result.current.applied).toMatchObject({ projectId: null, taskId: null, count: 2 });
  });

  it('dismissing the result does not undo the placement', async () => {
    const { result } = renderTriage();
    await act(async () => result.current.requestPreview());
    await act(async () => {
      await result.current.applyPreview();
    });
    act(() => result.current.dismissApplied());
    expect(result.current.applied).toBeNull();
    expect(mocks.undo).not.toHaveBeenCalled();
  });

  it('removes the destination when its placement is undone', async () => {
    mocks.undo.mockResolvedValue({ graph_revision: 7 });
    const { result } = renderTriage();
    await act(async () => result.current.requestPreview());
    await act(async () => {
      await result.current.applyPreview();
    });
    const undo = [...useToastStore.getState().toasts]
      .reverse()
      .find((toast) => toast.action?.label === 'Undo')?.action;
    expect(undo).toBeDefined();
    await act(async () => {
      undo?.onClick();
    });
    expect(result.current.applied).toBeNull();
  });

  it('blocks duplicate apply before the first response arrives', async () => {
    let finish!: (value: { graph_revision: number; change_set_id: string }) => void;
    mocks.place.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderTriage();
    await act(async () => result.current.requestPreview());
    let first!: Promise<AppliedInboxPlacement | null>;
    await act(async () => {
      first = result.current.applyPreview();
      expect(await result.current.applyPreview()).toBeNull();
    });
    expect(mocks.place).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ graph_revision: 6, change_set_id: 'change-1' });
      await first;
    });
    expect(result.current.applied?.count).toBe(1);
  });
});
