import { describe, expect, it } from 'vitest';
import { layoutFlow } from '../taskGraphLayout';

const node = (id: string, sortOrder: number) => ({ id, sortOrder });
const edge = (before: string, after: string) => ({ before, after });

function grid(layout: ReturnType<typeof layoutFlow>) {
  return Object.fromEntries(layout.placements.map((p) => [p.id, [p.column, p.row]]));
}

describe('flow layout', () => {
  it('keeps the main line on one row and drops a branch to the next row', () => {
    const layout = layoutFlow(
      [
        node('read', 0),
        node('kernel', 10),
        node('profile', 20),
        node('report', 30),
        node('submit', 40),
        node('papers', 50),
      ],
      [
        edge('read', 'kernel'),
        edge('kernel', 'profile'),
        edge('kernel', 'report'),
        edge('profile', 'submit'),
        edge('report', 'submit'),
      ],
    );

    expect(grid(layout)).toEqual({
      read: [0, 0],
      kernel: [1, 0],
      profile: [2, 0],
      report: [2, 1],
      submit: [3, 0],
    });
    expect(layout.unordered).toEqual(['papers']);
    expect(layout).toMatchObject({ columns: 4, rows: 2 });
  });

  it('puts the column by the longest chain, not by creation order', () => {
    const layout = layoutFlow(
      [node('late', 0), node('a', 10), node('b', 20)],
      [edge('a', 'b'), edge('b', 'late'), edge('a', 'late')],
    );

    expect(grid(layout)).toEqual({ a: [0, 0], b: [1, 0], late: [2, 0] });
  });

  it('starts a lone step as the flow and leaves unlinked steps apart', () => {
    expect(grid(layoutFlow([node('only', 0)], []))).toEqual({ only: [0, 0] });
    const loose = layoutFlow([node('x', 0), node('y', 1)], []);
    expect(loose.placements).toEqual([]);
    expect(loose.unordered).toEqual(['x', 'y']);
  });

  it('keeps cyclic data visible and ignores duplicate, self and missing edges', () => {
    const layout = layoutFlow(
      [node('a', 0), node('b', 1)],
      [edge('a', 'b'), edge('b', 'a'), edge('a', 'b'), edge('a', 'a'), edge('a', 'missing')],
    );

    expect(layout.placements.map((p) => p.id).sort()).toEqual(['a', 'b']);
    expect(layout.edges).toEqual([edge('a', 'b'), edge('b', 'a')]);
  });
});
