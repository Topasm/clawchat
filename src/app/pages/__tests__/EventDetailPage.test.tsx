import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { EventResponse } from '../../types/api';
import EventDetailPage from '../EventDetailPage';

const mocks = vi.hoisted(() => ({ events: [] as EventResponse[] }));

vi.mock('../../hooks/queries', () => ({
  queryKeys: { events: ['events'] },
  useEventsQuery: () => ({ data: mocks.events }),
  useUpdateEvent: () => ({ mutate: vi.fn() }),
  useDeleteEvent: () => ({ mutate: vi.fn() }),
  useDeleteEventOccurrence: () => ({ mutate: vi.fn() }),
}));

function event(overrides: Partial<EventResponse>): EventResponse {
  return {
    id: 'evt-1',
    title: 'Team planning',
    start_time: '2026-10-02T01:00:00Z',
    end_time: '2026-10-02T02:00:00Z',
    created_at: '2026-09-30T00:00:00Z',
    updated_at: '2026-09-30T00:00:00Z',
    ...overrides,
  } as EventResponse;
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/events/evt-1']}>
        <Routes>
          <Route path="/events/:eventId" element={<EventDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EventDetailPage', () => {
  it('keeps events from a connected calendar read-only', () => {
    mocks.events = [event({ origin: 'remote', read_only: true })];
    renderPage();
    expect(screen.getByDisplayValue('Team planning')).toHaveAttribute('readonly');
    expect(
      screen.getByText('From a connected calendar. Change it in that calendar.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete Event/ })).not.toBeInTheDocument();
  });

  it('lets ClawChat events be edited and deleted', () => {
    mocks.events = [event({ origin: 'local', read_only: false })];
    renderPage();
    expect(screen.getByDisplayValue('Team planning')).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: /Delete Event/ })).toBeInTheDocument();
  });
});
