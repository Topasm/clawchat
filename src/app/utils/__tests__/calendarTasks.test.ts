import { describe, expect, it } from 'vitest';
import { indexTasksByDate, toDateKey } from '../calendarUtils';
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
  it('runs a task from today through its due date', () => {
    const map = indexTasksByDate(
      [task({ due_date: new Date(2026, 8, 12, 23, 59).toISOString() })],
      today,
    );

    expect([...map.keys()].sort()).toEqual(['2026-09-10', '2026-09-11', '2026-09-12']);
    expect(map.get('2026-09-10')![0].position).toBe('start');
    expect(map.get('2026-09-11')![0].position).toBe('middle');
    expect(map.get('2026-09-12')![0].position).toBe('end');
  });

  it('collapses a task due today onto the single day', () => {
    const map = indexTasksByDate(
      [task({ due_date: new Date(2026, 8, 10, 18, 0).toISOString() })],
      today,
    );

    expect([...map.keys()]).toEqual(['2026-09-10']);
    expect(map.get('2026-09-10')![0].position).toBe('single');
    expect(map.get('2026-09-10')![0].isOverdue).toBe(false);
  });

  // An overdue task has no stretch left to work in, so it must not paint every
  // day between the missed deadline and today.
  it('shows an overdue task only on the day it was due', () => {
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
        task({ id: 'later', due_date: new Date(2026, 8, 20).toISOString() }),
        task({ id: 'sooner', due_date: new Date(2026, 8, 11).toISOString() }),
      ],
      today,
    );

    expect(map.get(toDateKey(today))!.map((s) => s.todo.id)).toEqual(['sooner', 'later']);
  });
});
