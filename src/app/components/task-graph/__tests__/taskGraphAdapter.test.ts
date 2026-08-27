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
  todo('write', { parent_id: 'project' }),
  todo('done', { parent_id: 'project', status: 'completed' }),
];

const relationships = [
  {
    id: 'relationship-1',
    source_task_id: 'write',
    target_task_id: 'research',
    type: 'depends_on',
  },
];

const baseOptions = {
  collapsedIds: new Set<string>(),
  relationships,
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
    expect(result.nodes.find((node) => node.id === 'write')?.data.dependencyCount).toBe(1);
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
      todo('draft', { parent_id: 'project' }),
      todo('review', { parent_id: 'project' }),
      todo('unrelated'),
    ];
    const contextualRelationships = [
      { source_task_id: 'draft', target_task_id: 'research', type: 'depends_on' },
      { source_task_id: 'review', target_task_id: 'draft', type: 'depends_on' },
    ];

    const result = expandTaskGraphContext(
      contextualTodos,
      [contextualTodos[3]],
      contextualRelationships,
    );

    expect(result.map((item) => item.id)).toEqual(['project', 'research', 'draft', 'review']);
  });

  it('does not loop on cyclic parent or dependency data', () => {
    const cyclicTodos = [todo('a', { parent_id: 'b' }), todo('b', { parent_id: 'a' })];
    const cyclicRelationships = [
      { source_task_id: 'a', target_task_id: 'b', type: 'depends_on' },
      { source_task_id: 'b', target_task_id: 'a', type: 'depends_on' },
    ];

    expect(expandTaskGraphContext(cyclicTodos, [cyclicTodos[0]], cyclicRelationships)).toEqual(
      cyclicTodos,
    );
  });

  it('ignores relationships that are absent from the available dataset', () => {
    const matched = todo('matched', { parent_id: 'missing-parent' });

    expect(
      expandTaskGraphContext(
        [matched],
        [matched],
        [{ source_task_id: 'matched', target_task_id: 'missing-task', type: 'depends_on' }],
      ),
    ).toEqual([matched]);
  });

  it('retains a 10,000-edge prerequisite fan-out', () => {
    const dependent = todo('dependent');
    const prerequisites = Array.from({ length: 10_000 }, (_, index) =>
      todo(`prerequisite-${index}`),
    );
    const manyRelationships = prerequisites.map((prerequisite) => ({
      source_task_id: dependent.id,
      target_task_id: prerequisite.id,
      type: 'depends_on',
    }));

    const result = expandTaskGraphContext(
      [dependent, ...prerequisites],
      [dependent],
      manyRelationships,
    );

    expect(result).toHaveLength(10_001);
    expect(result.at(-1)?.id).toBe('prerequisite-9999');
  });

  it('walks a 10,000-edge prerequisite chain without recursive stack growth', () => {
    const chainedTodos = Array.from({ length: 10_001 }, (_, index) => todo(`task-${index}`));
    const chainedRelationships = chainedTodos.slice(1).map((task, index) => ({
      source_task_id: task.id,
      target_task_id: chainedTodos[index].id,
      type: 'depends_on',
    }));

    const result = expandTaskGraphContext(
      chainedTodos,
      [chainedTodos.at(-1)!],
      chainedRelationships,
    );

    expect(result).toHaveLength(10_001);
    expect(result[0].id).toBe('task-0');
  });
});
