import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SimpleMode from '../SimpleMode';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  toggle: vi.fn(),
  setSimpleMode: vi.fn(),
  todos: [
    {
      id: 'open-task',
      title: 'Write release notes',
      status: 'pending',
      priority: 'medium',
      tags: [],
      parent_id: null,
      project_id: null,
      sort_order: 0,
      created_at: '2026-08-30T10:00:00.000Z',
      updated_at: '2026-08-30T10:00:00.000Z',
    },
    {
      id: 'done-task',
      title: 'Ship desktop build',
      status: 'completed',
      priority: 'medium',
      tags: [],
      parent_id: null,
      project_id: null,
      sort_order: 0,
      created_at: '2026-08-29T10:00:00.000Z',
      updated_at: '2026-08-30T09:00:00.000Z',
    },
  ],
}));

vi.mock('../../hooks/queries', () => ({
  queryKeys: { todos: ['todos'] },
  useTodosQuery: () => ({ data: mocks.todos, isLoading: false }),
  useCreateTodo: () => ({ mutate: mocks.create, isPending: false }),
  useToggleTodoComplete: () => ({ mutate: mocks.toggle }),
}));

vi.mock('../../stores/useAuthStore', () => ({
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({ serverUrl: 'http://localhost:8000', connectionStatus: 'connected' }),
}));

vi.mock('../../stores/useSettingsStore', () => ({
  useSettingsStore: (selector: (state: object) => unknown) =>
    selector({ setSimpleMode: mocks.setSimpleMode }),
}));

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderSimpleMode() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/today']}>
        <SimpleMode />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.toggle.mockReset();
  mocks.setSimpleMode.mockReset();
});

describe('SimpleMode', () => {
  it('shows only open tasks and creates a task from the inline input', () => {
    renderSimpleMode();

    expect(screen.getByText('Write release notes')).toBeInTheDocument();
    expect(screen.queryByText('Ship desktop build')).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), {
      target: { value: 'Plan tomorrow' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }));

    expect(mocks.create).toHaveBeenCalledWith({
      title: 'Plan tomorrow',
      status: 'pending',
      priority: 'medium',
      tags: [],
      source: 'quick_capture',
      inbox_state: 'classifying',
    });
  });

  it('switches between open and completed tasks and toggles completion', () => {
    renderSimpleMode();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark Write release notes complete' }));
    expect(mocks.toggle).toHaveBeenCalledWith({ id: 'open-task', currentStatus: 'pending' });

    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    expect(screen.getByText('Ship desktop build')).toBeInTheDocument();
    expect(screen.queryByText('Write release notes')).not.toBeInTheDocument();
  });

  it('restores expanded mode and navigates to the full task page', () => {
    renderSimpleMode();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to expanded mode' }));

    expect(mocks.setSimpleMode).toHaveBeenCalledWith(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/tasks');
  });
});
