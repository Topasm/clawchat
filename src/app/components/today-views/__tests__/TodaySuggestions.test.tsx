import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TodaySuggestion } from '../../../types/schemas';

const mocks = vi.hoisted(() => ({
  suggestions: [] as TodaySuggestion[],
  answer: vi.fn(),
  updateTodo: vi.fn(),
}));

vi.mock('../../../hooks/queries', () => ({
  useTodaySuggestionsQuery: () => ({ data: { suggestions: mocks.suggestions, auto_add: true } }),
  useAnswerTodaySuggestion: () => ({ mutate: mocks.answer, isPending: false }),
  useUpdateTodo: () => ({ mutate: mocks.updateTodo }),
}));

import TodaySuggestions from '../TodaySuggestions';

function suggestion(overrides: Partial<TodaySuggestion>): TodaySuggestion {
  return {
    id: 'evsug_1',
    kind: 'prepare_meeting',
    status: 'pending',
    auto_added: false,
    title: 'Write up progress before Advisor meeting',
    event_title: 'Advisor meeting',
    event_start: '2026-10-20T05:00:00Z',
    due_at: '2026-10-19T14:59:00Z',
    ...overrides,
  };
}

function renderIt(briefing = [] as Parameters<typeof TodaySuggestions>[0]['briefingSuggestions']) {
  return render(
    <MemoryRouter>
      <TodaySuggestions briefingSuggestions={briefing} />
    </MemoryRouter>,
  );
}

describe('TodaySuggestions', () => {
  beforeEach(() => {
    mocks.suggestions = [];
    mocks.answer.mockReset();
    mocks.updateTodo.mockReset();
  });

  it('shows nothing when there is nothing to suggest', () => {
    const { container } = renderIt();
    expect(container).toBeEmptyDOMElement();
  });

  it('folds calendar and briefing suggestions into one line', () => {
    mocks.suggestions = [
      suggestion({}),
      suggestion({
        id: 'evsug_2',
        kind: 'prepare_exam',
        status: 'accepted',
        auto_added: true,
        title: 'Prepare for GPU midterm',
      }),
    ];
    renderIt([{ action: 'start_with', todo_id: 'todo_1', title: 'Report', reason: 'Due today' }]);

    const line = screen.getByRole('button', { name: /Suggestions 3/ });
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Prepare for GPU midterm')).not.toBeInTheDocument();

    fireEvent.click(line);
    expect(screen.getByText('Prepare for GPU midterm')).toBeInTheDocument();
    expect(screen.getByText(/Added automatically/)).toBeInTheDocument();
    expect(screen.getByText('Report')).toBeInTheDocument();
  });

  it('adds, dismisses and undoes through the server', () => {
    mocks.suggestions = [
      suggestion({}),
      suggestion({ id: 'evsug_2', status: 'accepted', auto_added: true, title: 'Exam prep' }),
    ];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Suggestions 2/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mocks.answer).toHaveBeenCalledWith({ id: 'evsug_1', answer: 'accept' });

    fireEvent.click(screen.getByRole('button', { name: /Dismiss Write up progress/ }));
    expect(mocks.answer).toHaveBeenCalledWith({ id: 'evsug_1', answer: 'dismiss' });

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(mocks.answer).toHaveBeenCalledWith({ id: 'evsug_2', answer: 'undo' });
  });

  it('labels a time block with its hours', () => {
    mocks.suggestions = [
      suggestion({
        kind: 'time_block',
        title: 'GPU homework',
        block_start: '2026-10-22T05:00:00Z',
        block_end: '2026-10-22T07:00:00Z',
      }),
    ];
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /Suggestions 1/ }));
    expect(screen.getByText(/–.*: GPU homework/)).toBeInTheDocument();
    expect(screen.getByText(/this time is free/)).toBeInTheDocument();
  });
});
