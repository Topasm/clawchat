import { act, renderHook } from '@testing-library/react';
import type { DropResult } from '@hello-pangea/dnd';
import { describe, expect, it, vi } from 'vitest';
import useKanbanDragDrop from '../useKanbanDragDrop';

function drop(source: string, destination: string): DropResult {
  return {
    draggableId: 'task-1',
    type: 'DEFAULT',
    source: { droppableId: source, index: 0 },
    destination: { droppableId: destination, index: 1 },
    reason: 'DROP',
    mode: 'FLUID',
    combine: null,
  };
}

function setup(parentId: string | null = null) {
  const actions = {
    setTaskStatus: vi.fn(),
    reorderTodoInColumn: vi.fn(),
    setParent: vi.fn(),
    clearParent: vi.fn(),
    getParentId: vi.fn(() => parentId),
    getChildIds: vi.fn((): string[] => []),
  };
  const { result } = renderHook(() => useKanbanDragDrop(actions));
  return { actions, result };
}

describe('unified task column drag and drop', () => {
  it('reorders pending and in-progress work together without changing status', () => {
    const { actions, result } = setup();

    act(() => result.current.handleDragEnd(drop('active', 'active')));

    expect(actions.reorderTodoInColumn).toHaveBeenCalledWith('task-1', 1, 'active');
    expect(actions.setTaskStatus).not.toHaveBeenCalled();
  });

  it('restores closed work to the compatible pending state', () => {
    const { actions, result } = setup();

    act(() => result.current.handleDragEnd(drop('completed', 'active')));

    expect(actions.setTaskStatus).toHaveBeenCalledWith('task-1', 'pending');
  });

  it('still completes active work when moved to Done', () => {
    const { actions, result } = setup();

    act(() => result.current.handleDragEnd(drop('active', 'completed')));

    expect(actions.setTaskStatus).toHaveBeenCalledWith('task-1', 'completed');
  });
});
