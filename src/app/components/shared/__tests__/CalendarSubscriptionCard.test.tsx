import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarSubscriptionCard from '../CalendarSubscriptionCard';

const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));

vi.mock('../../../services/apiClient', () => ({
  default: { get: apiMocks.get, post: apiMocks.post, delete: apiMocks.delete },
}));

const SECRET = {
  active: true,
  url: 'https://host/api/events/feed/tok123.ics',
  webcal_url: 'webcal://host/api/events/feed/tok123.ics',
};

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(<CalendarSubscriptionCard />, { wrapper });
}

describe('CalendarSubscriptionCard', () => {
  beforeEach(() => {
    apiMocks.get.mockReset();
    apiMocks.post.mockReset();
    apiMocks.delete.mockReset();
    apiMocks.get.mockResolvedValue({ data: { active: false } });
  });

  it('shows the URL once it has been issued', async () => {
    apiMocks.post.mockResolvedValue({ data: SECRET });
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Create URL' }));

    await waitFor(() => expect(apiMocks.post).toHaveBeenCalledWith('/events/subscription'));
    expect(await screen.findByDisplayValue(SECRET.url)).toBeInTheDocument();
    expect(screen.getByDisplayValue(SECRET.webcal_url)).toBeInTheDocument();
  });

  it('warns that the link grants full read access', async () => {
    apiMocks.post.mockResolvedValue({ data: SECRET });
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Create URL' }));

    expect(await screen.findByText(/read your whole calendar/i)).toBeInTheDocument();
  });

  // The server keeps only a hash, so an existing URL can never be re-shown.
  it('never displays a URL for a subscription it did not just issue', async () => {
    apiMocks.get.mockResolvedValue({
      data: { active: true, created_at: '2026-08-01T00:00:00Z', last_used_at: null },
    });
    renderCard();

    expect(await screen.findByRole('button', { name: 'Replace URL' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/feed\//)).not.toBeInTheDocument();
    expect(screen.getByText(/cannot be shown again/i)).toBeInTheDocument();
  });

  it('revokes and stops offering the revoke action', async () => {
    apiMocks.get.mockResolvedValueOnce({ data: { active: true } });
    apiMocks.delete.mockResolvedValue({});
    apiMocks.get.mockResolvedValue({ data: { active: false } });
    renderCard();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));

    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith('/events/subscription'));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument(),
    );
  });

  it('offers no revoke action when there is nothing to revoke', async () => {
    renderCard();

    expect(await screen.findByRole('button', { name: 'Create URL' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });
});
