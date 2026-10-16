import { describe, expect, it } from 'vitest';
import { buildExecutionGraphLayout } from '../taskGraphLayout';

const tasks = [
  { id: 'project', title: 'Project', sort_order: 0 },
  { id: 'design', title: 'Design', parent_id: 'project', sort_order: 0 },
  { id: 'build', title: 'Build', parent_id: 'project', sort_order: 1 },
  { id: 'ship', title: 'Ship', parent_id: 'build', sort_order: 0 },
];

const relationships = [
  {
    id: 'relationship-1',
    source_task_id: 'build',
    target_task_id: 'design',
    type: 'depends_on',
  },
];

describe('task graph layout', () => {
  it('renders stored task-to-prerequisite relationships as prerequisite-to-task arrows', () => {
    const layout = buildExecutionGraphLayout(tasks, relationships);
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.edges).toContainEqual({
      id: 'dependency:design:build',
      sourceId: 'design',
      targetId: 'build',
      type: 'dependency',
    });
    expect(positions.get('build')!.x).toBeGreaterThan(positions.get('design')!.x);
  });

  it("places nodes with the caller's box size and gaps", () => {
    const layout = buildExecutionGraphLayout(tasks, relationships, {
      nodeWidth: 100,
      nodeHeight: 40,
      columnGap: 20,
      rowGap: 10,
      padding: 4,
    });
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(positions.get('design')).toMatchObject({ x: 4 });
    expect(positions.get('build')).toMatchObject({ x: 124 });
    expect(layout.width).toBe(124 + 100 + 4);
  });

  it('keeps cyclic dependency data visible with both directed edges', () => {
    const layout = buildExecutionGraphLayout(
      [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      [
        { source_task_id: 'a', target_task_id: 'b', type: 'depends_on' },
        { source_task_id: 'b', target_task_id: 'a', type: 'depends_on' },
      ],
    );

    expect(new Set(layout.nodes.map((node) => node.id))).toEqual(new Set(['a', 'b']));
    expect(new Set(layout.edges.map((edge) => edge.id))).toEqual(
      new Set(['dependency:b:a', 'dependency:a:b']),
    );
  });

  it('deduplicates repeated dependencies and ignores missing or self references', () => {
    const layout = buildExecutionGraphLayout(
      [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
      [
        { source_task_id: 'b', target_task_id: 'a', type: 'depends_on' },
        { source_task_id: 'b', target_task_id: 'a', type: 'depends_on' },
        { source_task_id: 'b', target_task_id: 'b', type: 'depends_on' },
        { source_task_id: 'b', target_task_id: 'missing', type: 'depends_on' },
        { source_task_id: 'b', target_task_id: 'a', type: 'related' },
      ],
    );

    expect(layout.edges).toEqual([
      {
        id: 'dependency:a:b',
        sourceId: 'a',
        targetId: 'b',
        type: 'dependency',
      },
    ]);
  });
});
