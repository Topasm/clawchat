import { describe, expect, it } from 'vitest';
import type { TodoResponse } from '../../types/api';
import { isInboxTodo, isTaskTodo } from '../inboxState';

function todo(overrides: Partial<TodoResponse> = {}): TodoResponse {
  return {
    id: 'task-1',
    title: 'Task',
    status: 'pending',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Inbox task classification', () => {
  it('uses explicit workflow state as the source of truth', () => {
    expect(isInboxTodo(todo({ inbox_state: 'captured', due_date: '2026-09-01' }))).toBe(true);
    expect(isInboxTodo(todo({ inbox_state: 'classifying', project_id: 'project-1' }))).toBe(true);
    expect(isInboxTodo(todo({ inbox_state: 'none' }))).toBe(false);
  });

  it('uses the unfiled heuristic only when a legacy response omits inbox_state', () => {
    expect(isInboxTodo(todo())).toBe(true);
    expect(isInboxTodo(todo({ project_id: 'project-1' }))).toBe(false);
    expect(isInboxTodo(todo({ due_date: '2026-09-01' }))).toBe(false);
    expect(isInboxTodo(todo({ parent_id: 'parent-1' }))).toBe(false);
  });

  it('keeps terminal captures out of the active Inbox and in task history', () => {
    const completedCapture = todo({ status: 'completed', inbox_state: 'captured' });
    expect(isInboxTodo(completedCapture)).toBe(false);
    expect(isTaskTodo(completedCapture)).toBe(true);
  });
});
