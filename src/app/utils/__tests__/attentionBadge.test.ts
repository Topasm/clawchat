import { describe, expect, it } from 'vitest';
import type { TodoResponse } from '../../types/api';
import { getAttentionBadgeCounts } from '../attentionBadge';

function todo(
  id: string,
  status: TodoResponse['status'],
  options: Partial<TodoResponse> = {},
): TodoResponse {
  return {
    id,
    title: id,
    status,
    inbox_state: 'none',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...options,
  } as TodoResponse;
}

describe('getAttentionBadgeCounts', () => {
  it('counts Inbox and both active due statuses without terminal tasks', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const counts = getAttentionBadgeCounts(
      [
        todo('inbox', 'pending', { inbox_state: 'captured' }),
        todo('pending-due', 'pending', { due_date: '2026-08-31T12:00:00Z' }),
        todo('progress-due', 'in_progress', { due_date: '2026-09-01T12:00:00Z' }),
        todo('completed-due', 'completed', { due_date: '2026-08-31T12:00:00Z' }),
        todo('future', 'pending', { due_date: '2026-09-03T12:00:00Z' }),
      ],
      now,
    );

    expect(counts).toEqual({ inboxCount: 1, dueCount: 2, total: 3 });
  });
});
