import { describe, expect, it } from 'vitest';
import {
  buildExecutionGraphLayout,
  buildStructureGraphLayout,
  GRAPH_COLUMN_GAP,
  GRAPH_NODE_WIDTH,
} from '../taskGraphLayout';

const tasks = [
  { id: 'project', title: 'Project', sort_order: 0 },
  { id: 'design', title: 'Design', parent_id: 'project', sort_order: 0 },
  { id: 'build', title: 'Build', parent_id: 'project', depends_on: ['design'], sort_order: 1 },
  { id: 'ship', title: 'Ship', parent_id: 'build', sort_order: 0 },
];

describe('task graph layout', () => {
  it('lays parent and child tasks out in left-to-right depth columns', () => {
    const layout = buildStructureGraphLayout(tasks);
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.nodes).toHaveLength(4);
    expect(positions.get('design')!.x - positions.get('project')!.x).toBe(
      GRAPH_NODE_WIDTH + GRAPH_COLUMN_GAP,
    );
    expect(positions.get('ship')!.x).toBeGreaterThan(positions.get('build')!.x);
    expect(layout.edges.filter((edge) => edge.type === 'hierarchy')).toHaveLength(3);
  });

  it('turns depends_on references into directional dependency edges', () => {
    const layout = buildExecutionGraphLayout(tasks);
    const positions = new Map(layout.nodes.map((node) => [node.id, node]));

    expect(layout.edges).toContainEqual({
      id: 'dependency:design:build',
      sourceId: 'design',
      targetId: 'build',
      type: 'dependency',
    });
    expect(positions.get('build')!.x).toBeGreaterThan(positions.get('design')!.x);
    expect(layout.edges.some((edge) => edge.type === 'hierarchy')).toBe(false);
  });

  it('hides descendants of collapsed tasks but keeps the collapsed node visible', () => {
    const layout = buildStructureGraphLayout(tasks, new Set(['build']));

    expect(layout.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['project', 'design', 'build']));
    expect(layout.nodes.map((node) => node.id)).not.toContain('ship');
  });

  it('keeps malformed cyclic parent data visible', () => {
    const layout = buildStructureGraphLayout([
      { id: 'a', title: 'A', parent_id: 'b' },
      { id: 'b', title: 'B', parent_id: 'a' },
    ]);

    expect(new Set(layout.nodes.map((node) => node.id))).toEqual(new Set(['a', 'b']));
  });

  it('keeps cyclic dependency data visible with both directed edges', () => {
    const layout = buildExecutionGraphLayout([
      { id: 'a', title: 'A', depends_on: ['b'] },
      { id: 'b', title: 'B', depends_on: ['a'] },
    ]);

    expect(new Set(layout.nodes.map((node) => node.id))).toEqual(new Set(['a', 'b']));
    expect(new Set(layout.edges.map((edge) => edge.id))).toEqual(new Set([
      'dependency:b:a',
      'dependency:a:b',
    ]));
  });

  it('deduplicates repeated dependencies and ignores missing or self references', () => {
    const layout = buildExecutionGraphLayout([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', depends_on: ['a', 'a', 'b', 'missing'] },
    ]);

    expect(layout.edges).toEqual([{
      id: 'dependency:a:b',
      sourceId: 'a',
      targetId: 'b',
      type: 'dependency',
    }]);
  });
});
