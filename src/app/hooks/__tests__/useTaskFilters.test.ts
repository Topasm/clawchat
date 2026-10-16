import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useTaskFilters, { isWaitingOnPrerequisite } from '../useTaskFilters';
import type { TodoResponse } from '../../types/api';

function todo(overrides: Partial<TodoResponse>): TodoResponse {
  return {
    id: 'task',
    title: 'Task',
    status: 'pending',
    priority: 'medium',
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T00:00:00Z',
    ...overrides,
  } as TodoResponse;
}

const base = {
  searchQuery: '',
  tags: [],
  sortField: 'title' as const,
  sortDirection: 'asc' as const,
};

describe('useTaskFilters', () => {
  it('keeps only tasks waiting on an unfinished prerequisite when asked', () => {
    const todos = [
      todo({ id: 'a', title: 'A' }),
      todo({ id: 'b', title: 'B', open_prerequisites: [{ id: 'a', title: 'A' }] }),
      todo({
        id: 'c',
        title: 'C',
        status: 'completed',
        open_prerequisites: [{ id: 'a', title: 'A' }],
      }),
    ];
    const { result } = renderHook(() => useTaskFilters(todos, { ...base, blockedOnly: true }));
    expect(result.current.map((entry) => entry.id)).toEqual(['b']);
    const all = renderHook(() => useTaskFilters(todos, base));
    expect(all.result.current).toHaveLength(3);
  });

  it('treats an empty prerequisite list as not waiting', () => {
    expect(isWaitingOnPrerequisite(todo({ open_prerequisites: [] }))).toBe(false);
    expect(isWaitingOnPrerequisite(todo({}))).toBe(false);
  });
});
