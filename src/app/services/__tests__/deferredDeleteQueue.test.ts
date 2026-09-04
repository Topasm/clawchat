import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferredDeleteQueue } from '../deferredDeleteQueue';

describe('deferredDeleteQueue', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists a scoped delete until it is cancelled', () => {
    expect(deferredDeleteQueue.enqueue('host-a', 'todo', 'todo-1')).toBe(true);
    expect(deferredDeleteQueue.getItems('host-a')).toEqual([
      expect.objectContaining({ scope: 'host-a', kind: 'todo', resourceId: 'todo-1' }),
    ]);

    expect(deferredDeleteQueue.cancel('host-a', 'todo', 'todo-1')).toBe(true);
    expect(deferredDeleteQueue.getItems('host-a')).toEqual([]);
  });

  it('does not expose another authenticated scope pending deletes', () => {
    deferredDeleteQueue.enqueue('host-a', 'event', 'event-1');

    expect(deferredDeleteQueue.getItems('host-b')).toEqual([]);
    expect(deferredDeleteQueue.getItems('host-a')).toHaveLength(1);
  });

  it('replaces a duplicate instead of deleting the same resource twice', () => {
    deferredDeleteQueue.enqueue('host-a', 'todo', 'todo-1');
    deferredDeleteQueue.enqueue('host-a', 'todo', 'todo-1');

    expect(deferredDeleteQueue.getItems('host-a')).toHaveLength(1);
  });

  it('moves failed work to a later retry time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    deferredDeleteQueue.enqueue('host-a', 'todo', 'todo-1', 0);
    const [item] = deferredDeleteQueue.getItems('host-a');

    deferredDeleteQueue.retry(item.id, 30_000);

    expect(deferredDeleteQueue.getItems('host-a')[0].executeAt).toBe(31_000);
  });
});
