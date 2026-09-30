import { describe, expect, it } from 'vitest';
import { indexTasksByDate } from '../calendarUtils';
import type { TodoResponse } from '../../types/api';

function task(overrides: Partial<TodoResponse>): TodoResponse {
  return {
    id: 'todo-1',
    title: 'Ship the release',
    status: 'pending',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  } as TodoResponse;
}

const today = new Date(2026, 8, 10); // 2026-09-10, local

describe('indexTasksByDate', () => {
  // A deadline is a day, not a span: painting today through the due date read
  // as a multi-day event and filled the month with unlabelled bars.
  it('puts a task on its due date alone', () => {
    const map = indexTasksByDate(
      [task({ due_date: new Date(2026, 8, 12, 23, 59).toISOString() })],
      today,
    );

    expect([...map.keys()]).toEqual(['2026-09-12']);
    expect(map.get('2026-09-12')![0].isOverdue).toBe(false);
  });

  it('marks a task whose due date has passed as overdue', () => {
    const map = indexTasksByDate(
      [task({ due_date: new Date(2026, 8, 7, 23, 59).toISOString() })],
      today,
    );

    expect([...map.keys()]).toEqual(['2026-09-07']);
    expect(map.get('2026-09-07')![0].isOverdue).toBe(true);
  });

  it('leaves out finished work and tasks with no deadline', () => {
    const map = indexTasksByDate(
      [
        task({ id: 'a', status: 'completed', due_date: new Date(2026, 8, 11).toISOString() }),
        task({ id: 'b', status: 'cancelled', due_date: new Date(2026, 8, 11).toISOString() }),
        task({ id: 'c', due_date: null }),
        task({ id: 'd', due_date: 'not a date' }),
      ],
      today,
    );

    expect(map.size).toBe(0);
  });

  it('puts the soonest deadline first on a shared day', () => {
    const map = indexTasksByDate(
      [
        task({ id: 'later', due_date: new Date(2026, 8, 11, 18).toISOString() }),
        task({ id: 'sooner', due_date: new Date(2026, 8, 11, 9).toISOString() }),
      ],
      today,
    );

    expect(map.get('2026-09-11')!.map((s) => s.todo.id)).toEqual(['sooner', 'later']);
  });
});
