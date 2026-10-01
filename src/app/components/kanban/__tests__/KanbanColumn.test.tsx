import { render, screen } from '@testing-library/react';
import { DragDropContext } from '@hello-pangea/dnd';
import { describe, expect, it, vi } from 'vitest';
import type { TodoResponse } from '../../../types/api';
import KanbanColumn from '../KanbanColumn';

vi.mock('../../../hooks/queries', () => ({
  useTaskRelationshipsQuery: () => ({ data: [] }),
}));

const TIMESTAMPS = { created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' };

function todo(overrides: Partial<TodoResponse> & Pick<TodoResponse, 'id' | 'title'>): TodoResponse {
  return {
    status: 'pending',
    sort_order: 0,
    inbox_state: 'none',
    ...TIMESTAMPS,
    ...overrides,
  } as TodoResponse;
}

// A placed task hangs off its project's root task, which the board never lists.
const placed = [
  todo({ id: 'task-1', title: 'Run ablation', project_id: 'p1', parent_id: 'root-1' }),
  todo({ id: 'task-2', title: 'Write related work', project_id: 'p1', parent_id: 'root-1' }),
];
const child = todo({ id: 'task-3', title: 'Plot curves', project_id: 'p1', parent_id: 'task-1' });

function renderColumn(tasks: TodoResponse[], allTodos: TodoResponse[]) {
  return render(
    <DragDropContext onDragEnd={() => undefined}>
      <KanbanColumn
        status="active"
        title="Tasks"
        icon={null}
        tasks={tasks}
        allTodos={allTodos}
        showSubTasks={false}
        onToggle={() => undefined}
        onClickTask={() => undefined}
      />
    </DragDropContext>,
  );
}

describe('KanbanColumn', () => {
  it('shows tasks whose parent is a project root the board does not list', () => {
    renderColumn(placed, placed);

    expect(screen.getByText('Run ablation')).toBeInTheDocument();
    expect(screen.getByText('Write related work')).toBeInTheDocument();
    expect(screen.queryByText('No tasks')).not.toBeInTheDocument();
  });

  it('still folds a real sub-task under its parent', () => {
    const all = [...placed, child];
    renderColumn(all, all);

    expect(screen.queryByText('Plot curves')).not.toBeInTheDocument();
    expect(screen.getByText(/1 sub-task/)).toBeInTheDocument();
  });
});
