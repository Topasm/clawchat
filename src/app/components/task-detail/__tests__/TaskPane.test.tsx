import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskPane from '../TaskPane';
import type { TaskMenuItem } from '../TaskMoreMenu';

vi.mock('../TaskDetail', () => ({
  // The real detail renders its ⋮ into the pane's slot (covered in
  // TaskDetailPage.test); here the host's entries are enough.
  default: ({ taskId, extraMenuItems }: { taskId: string; extraMenuItems?: TaskMenuItem[] }) => (
    <div>
      Detail of {taskId}
      {extraMenuItems?.map((item) => (
        <button key={item.label} type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../../chat-panel/ChatPanel', () => ({
  default: ({ hideHeader }: { hideHeader?: boolean }) => (
    <div>Chat panel{hideHeader ? ' without header' : ''}</div>
  ),
}));

function Location() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

const handlers = {
  onModeChange: vi.fn(),
  onOpenTask: vi.fn(),
  onClose: vi.fn(),
};

function renderPane(mode: 'task' | 'chat' = 'task') {
  return render(
    <MemoryRouter initialEntries={['/tasks?task=todo-1']}>
      <Location />
      <Routes>
        <Route
          path="*"
          element={
            <TaskPane
              taskId="todo-1"
              mode={mode}
              {...handlers}
              chat={{ conversationId: 'conv-1', onSetConversationId: vi.fn(), title: 'AI · Tasks' }}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('TaskPane', () => {
  beforeEach(() => {
    handlers.onModeChange.mockReset();
    handlers.onOpenTask.mockReset();
    handlers.onClose.mockReset();
  });

  it('shows the task behind a Task | AI header and switches on the segments', () => {
    renderPane();

    expect(screen.getByText('Detail of todo-1')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Task' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: /AI/ }));
    expect(handlers.onModeChange).toHaveBeenCalledWith('chat');
  });

  it('puts the conversation in the same slot without a second header', () => {
    renderPane('chat');

    expect(screen.getByText('Chat panel without header')).toBeInTheDocument();
    expect(screen.queryByText('Detail of todo-1')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /AI/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('closes on the close button and on Escape', () => {
    renderPane();

    fireEvent.click(screen.getByRole('button', { name: 'Close pane' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });

  it('opens the task as its own page from the menu', () => {
    renderPane();

    fireEvent.click(screen.getByRole('button', { name: 'Open as page' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/tasks/todo-1');
  });
});
