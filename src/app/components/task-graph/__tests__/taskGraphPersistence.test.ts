import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTaskGraphLayoutScope,
  loadTaskGraphLayout,
  resetTaskGraphLayout,
  updateTaskGraphLayout,
} from '../taskGraphPersistence';

describe('task graph persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps project and graph-mode layouts independent', () => {
    const structure = createTaskGraphLayoutScope('project/a', 'structure');
    const execution = createTaskGraphLayoutScope('project/a', 'execution');

    updateTaskGraphLayout(structure, {
      positions: { task: { x: 12, y: 34 } },
      viewport: { x: 1, y: 2, zoom: 0.75 },
      collapsedIds: ['parent'],
    });

    expect(loadTaskGraphLayout(structure)).toEqual({
      positions: { task: { x: 12, y: 34 } },
      viewport: { x: 1, y: 2, zoom: 0.75 },
      collapsedIds: ['parent'],
      initialized: true,
    });
    expect(loadTaskGraphLayout(execution)).toEqual({
      positions: {},
      collapsedIds: [],
      initialized: false,
    });
  });

  it('merges partial updates without discarding other layout state', () => {
    const scope = createTaskGraphLayoutScope('all', 'execution');
    updateTaskGraphLayout(scope, {
      positions: { first: { x: 10, y: 20 } },
      collapsedIds: ['first'],
    });
    updateTaskGraphLayout(scope, { viewport: { x: 30, y: 40, zoom: 1.2 } });

    expect(loadTaskGraphLayout(scope)).toEqual({
      positions: { first: { x: 10, y: 20 } },
      viewport: { x: 30, y: 40, zoom: 1.2 },
      collapsedIds: ['first'],
      initialized: true,
    });
  });

  it('sanitizes malformed storage and deduplicates collapsed task IDs', () => {
    localStorage.setItem(
      'clawchat-task-graph-layouts-v1',
      JSON.stringify({
        scope: {
          positions: {
            valid: { x: 1, y: 2 },
            invalid: { x: '1', y: 2 },
          },
          viewport: { x: 0, y: 0, zoom: 0 },
          collapsedIds: ['one', 'one', 2],
        },
      }),
    );

    expect(loadTaskGraphLayout('scope')).toEqual({
      positions: { valid: { x: 1, y: 2 } },
      collapsedIds: ['one'],
      initialized: true,
    });
  });

  it('resets only the selected scope', () => {
    const first = createTaskGraphLayoutScope('first', 'structure');
    const second = createTaskGraphLayoutScope('second', 'structure');
    updateTaskGraphLayout(first, { collapsedIds: ['a'] });
    updateTaskGraphLayout(second, { collapsedIds: ['b'] });

    resetTaskGraphLayout(first);

    expect(loadTaskGraphLayout(first).collapsedIds).toEqual([]);
    expect(loadTaskGraphLayout(first).initialized).toBe(false);
    expect(loadTaskGraphLayout(second).collapsedIds).toEqual(['b']);
  });
});
