import { describe, expect, it, vi } from 'vitest';
import type { TodoResponse } from '../../../types/api';
import { buildTaskGraphElements, expandTaskGraphContext } from '../taskGraphAdapter';

function todo(id: string, overrides: Partial<TodoResponse> = {}): TodoResponse {
  return {
    id,
    title: id,
    status: 'pending',
    priority: 'medium',
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    ...overrides,
  };
}

const todos = [
  todo('project'),
  todo('research', { parent_id: 'project', tags: ['paper'] }),
  todo('write', { parent_id: 'project', depends_on: ['research'] }),
  todo('done', { parent_id: 'project', status: 'completed' }),
];

const baseOptions = {
  collapsedIds: new Set<string>(),
  kanbanStatuses: {},
  onToggleCollapse: vi.fn(),
};

describe('buildTaskGraphElements', () => {
  it('uses only parent_id relationships in structure mode', () => {
    const result = buildTaskGraphElements(todos, {
      ...baseOptions,
      mode: 'structure',
      hideCompleted: false,
    });

    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
    expect(result.edges.every((edge) => edge.id.startsWith('hierarchy:'))).toBe(true);
    expect(result.edges.every((edge) => edge.markerEnd === undefined)).toBe(true);
  });

  it('uses only depends_on relationships in execution mode', () => {
    const result = buildTaskGraphElements(todos, {
      ...baseOptions,
      mode: 'execution',
      hideCompleted: false,
    });

    expect(result.edges.map((edge) => edge.id)).toEqual(['dependency:research:write']);
    expect(result.edges[0].markerEnd).toBeDefined();
  });

  it('can hide completed nodes without changing the source data', () => {
    const result = buildTaskGraphElements(todos, {
      ...baseOptions,
      mode: 'structure',
      hideCompleted: true,
    });

    expect(result.nodes.map((node) => node.id)).not.toContain('done');
    expect(todos).toHaveLength(4);
  });

  it('keeps full sub-task progress when completed nodes are hidden', () => {
    const result = buildTaskGraphElements(todos, {
      ...baseOptions,
      mode: 'structure',
      hideCompleted: true,
      metadataTodos: todos,
    });
    const project = result.nodes.find((node) => node.id === 'project')!;

    expect(project.data.childCount).toBe(3);
    expect(project.data.completedChildCount).toBe(1);
    expect(project.data.hasVisibleChildren).toBe(true);
  });

  it('passes collapse actions through node data for preview-friendly separation', () => {
    const onToggleCollapse = vi.fn();
    const result = buildTaskGraphElements(todos, {
      ...baseOptions,
      mode: 'structure',
      hideCompleted: false,
      onToggleCollapse,
    });

    result.nodes.find((node) => node.id === 'project')!.data.onToggleCollapse('project');
    expect(onToggleCollapse).toHaveBeenCalledWith('project');
  });
});

describe('expandTaskGraphContext', () => {
  it('retains every ancestor and transitive prerequisite of a match', () => {
    const contextualTodos = [
      todo('project'),
      todo('research', { parent_id: 'project' }),
      todo('draft', { parent_id: 'project', depends_on: ['research'] }),
      todo('review', { parent_id: 'project', depends_on: ['draft'] }),
      todo('unrelated'),
    ];

    const result = expandTaskGraphContext(contextualTodos, [contextualTodos[3]]);

    expect(result.map((item) => item.id)).toEqual(['project', 'research', 'draft', 'review']);
  });

  it('does not loop on cyclic parent or dependency data', () => {
    const cyclicTodos = [
      todo('a', { parent_id: 'b', depends_on: ['b'] }),
      todo('b', { parent_id: 'a', depends_on: ['a'] }),
    ];

    expect(expandTaskGraphContext(cyclicTodos, [cyclicTodos[0]])).toEqual(cyclicTodos);
  });

  it('ignores relationships that are absent from the available dataset', () => {
    const matched = todo('matched', { parent_id: 'missing-parent', depends_on: ['missing-task'] });

    expect(expandTaskGraphContext([matched], [matched])).toEqual([matched]);
  });
});
