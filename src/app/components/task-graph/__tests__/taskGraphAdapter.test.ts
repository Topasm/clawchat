import { describe, expect, it, vi } from 'vitest';
import type { TaskGraphInsightNode, TodoResponse } from '../../../types/api';
import {
  augmentTaskGraphTodos,
  buildTaskGraphElements,
  collectDefaultCollapsedTaskIds,
  collectTaskSubtreeIds,
  expandTaskGraphContext,
  mergeExecutionRelationships,
} from '../taskGraphAdapter';

function todo(id: string, overrides: Partial<TodoResponse> = {}): TodoResponse {
  return {
    id,
    title: id,
    status: 'pending',
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

describe('collectTaskSubtreeIds', () => {
  it('starts from the project root Todo rather than the first-class Project id', () => {
    const projectTodos = [
      todo('todo_root', { project_id: 'project_1', source: 'project_root' }),
      todo('todo_child', { project_id: 'project_1', parent_id: 'todo_root' }),
      todo('todo_grandchild', { project_id: 'project_1', parent_id: 'todo_child' }),
      todo('todo_other', { project_id: 'project_2' }),
    ];

    expect([...collectTaskSubtreeIds('todo_root', projectTodos)]).toEqual([
      'todo_root',
      'todo_child',
      'todo_grandchild',
    ]);
    expect([...collectTaskSubtreeIds('project_1', projectTodos)]).toEqual(['project_1']);
  });
});

describe('collectDefaultCollapsedTaskIds', () => {
  it('collapses question nodes that own project depth-two experiment steps', () => {
    const projectTodos = [
      todo('question', { parent_id: 'project-root' }),
      todo('experiment-a', { parent_id: 'question' }),
      todo('experiment-b', { parent_id: 'question' }),
      todo('standalone', { parent_id: 'project-root' }),
    ];

    expect([...collectDefaultCollapsedTaskIds(projectTodos, 'project-root')]).toEqual(['question']);
  });
});

function insight(
  taskId: string,
  overrides: Partial<TaskGraphInsightNode> = {},
): TaskGraphInsightNode {
  return {
    task_id: taskId,
    title: taskId,
    status: 'pending',
    parent_id: null,
    scope_role: 'global',
    execution_state: 'pending',
    estimated_minutes: 30,
    due_date: null,
    dependency_ids: [],
    direct_blocker_ids: [],
    transitive_blocker_ids: [],
    transitive_blocker_count: 0,
    transitive_blockers_truncated: false,
    downstream_task_ids: [],
    downstream_count: 0,
    downstream_truncated: false,
    is_container: false,
    is_ready: false,
    is_blocked: false,
    is_unschedulable: false,
    is_on_critical_path: false,
    remaining_path_minutes: 30,
    remaining_path_known_minutes: 30,
    estimate_complete: true,
    due_risk: 'none',
    due_slack_minutes: null,
    ...overrides,
  };
}

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

  it('attaches server-derived execution state and highlights only consecutive critical edges', () => {
    const result = buildTaskGraphElements(todos, {
      ...baseOptions,
      mode: 'execution',
      hideCompleted: false,
      insightNodes: [
        insight('research', { is_ready: true, execution_state: 'ready' }),
        insight('write', { is_on_critical_path: true, execution_state: 'blocked' }),
      ],
      criticalPathTaskIds: ['research', 'write'],
    });

    expect(result.nodes.find((node) => node.id === 'research')?.data.insight?.is_ready).toBe(true);
    expect(result.edges[0].className).toContain('cc-task-flow__edge--critical');
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

describe('insight snapshot pagination recovery', () => {
  it('hydrates every missing snapshot node when external filters are inactive', () => {
    const metadataOnly = todo('metadata-only', { title: 'Canonical metadata task' });
    const result = augmentTaskGraphTodos(
      [todo('loaded')],
      [todo('loaded'), metadataOnly],
      [
        insight('metadata-only', { title: 'Snapshot metadata title' }),
        insight('over-page', { title: 'Task beyond Todo pagination', status: 'in_progress' }),
      ],
      '2026-08-27T12:00:00Z',
      { includeAllMissing: true, includeContextMissing: false },
    );

    expect(result.map((item) => item.id)).toEqual(['loaded', 'metadata-only', 'over-page']);
    expect(result[1]).toBe(metadataOnly);
    expect(result[2]).toMatchObject({
      title: 'Task beyond Todo pagination',
      status: 'in_progress',
      source: 'graph_insight',
      project_label: 'Graph snapshot',
    });
  });

  it('preserves external filter meaning while restoring prerequisite context', () => {
    const result = augmentTaskGraphTodos(
      [todo('matched')],
      [],
      [
        insight('unmatched-primary', { scope_role: 'global' }),
        insight('external-prerequisite', { scope_role: 'context' }),
      ],
      '2026-08-27T12:00:00Z',
      { includeAllMissing: false, includeContextMissing: true },
    );

    expect(result.map((item) => item.id)).toEqual(['matched', 'external-prerequisite']);
    expect(result[1].project_label).toBe('External prerequisite');
  });

  it('merges edges beyond relationship pagination and deduplicates normalized rows', () => {
    const paginatedRelationships = Array.from({ length: 10_000 }, (_, index) => ({
      id: `relationship-${index}`,
      source_task_id: `dependent-${index}`,
      target_task_id: `prerequisite-${index}`,
      type: 'depends_on',
    }));
    const result = mergeExecutionRelationships(paginatedRelationships, [
      insight('dependent-0', { dependency_ids: ['prerequisite-0'] }),
      insight('dependent-over-page', { dependency_ids: ['prerequisite-over-page'] }),
    ]);

    expect(result).toHaveLength(10_001);
    expect(result.at(-1)).toEqual({
      id: 'insight-dependency:dependent-over-page:prerequisite-over-page',
      source_task_id: 'dependent-over-page',
      target_task_id: 'prerequisite-over-page',
      type: 'depends_on',
    });
  });
});
