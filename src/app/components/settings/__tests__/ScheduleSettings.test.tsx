import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../../i18n';
import ScheduleSettings from '../ScheduleSettings';

const api = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ default: api }));
vi.mock('../../../services/jobSchedule', () => ({ localTimeZone: () => 'Asia/Seoul' }));

const plan = {
  briefing_enabled: true,
  briefing_time: '08:00',
  weekly_review_enabled: false,
  weekly_review_day: 'sunday',
  weekly_review_time: '09:00',
  timezone: '',
  effective_timezone: 'UTC',
  next_briefing_at: '2026-10-03T08:00:00Z',
  next_weekly_review_at: null,
};

function renderSchedule() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ScheduleSettings />
    </QueryClientProvider>,
  );
}

describe('Briefing schedule settings', () => {
  beforeEach(async () => {
    await changeAppLanguage('en');
    api.get.mockReset();
    api.put.mockReset();
    api.get.mockResolvedValue({ data: plan });
  });

  it('shows the schedule and saves a new briefing time on change', async () => {
    api.put.mockResolvedValue({ data: { ...plan, briefing_time: '07:30' } });
    renderSchedule();
    const time = await screen.findByDisplayValue('08:00');
    expect(time).toHaveAccessibleName('Briefing time');
    expect(screen.getByText(/^Next: /)).toBeInTheDocument();

    fireEvent.change(time, { target: { value: '07:30' } });
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/settings/schedule',
        { briefing_time: '07:30' },
        { queueOfflineMutation: false },
      ),
    );
    expect(await screen.findByDisplayValue('07:30')).toBeInTheDocument();
  });

  it('keeps the weekly review controls disabled until it is switched on', async () => {
    api.put.mockResolvedValue({ data: { ...plan, weekly_review_enabled: true } });
    renderSchedule();
    await screen.findByDisplayValue('08:00');
    expect(screen.getByLabelText('Review day')).toBeDisabled();
    fireEvent.click(screen.getByRole('switch', { name: 'Weekly review' }));
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/settings/schedule',
        { weekly_review_enabled: true },
        { queueOfflineMutation: false },
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('Review day')).toBeEnabled());
  });

  it('offers the device zone when the server reads times elsewhere', async () => {
    api.put.mockResolvedValue({
      data: { ...plan, timezone: 'Asia/Seoul', effective_timezone: 'Asia/Seoul' },
    });
    renderSchedule();
    const button = await screen.findByRole('button', { name: 'Use Asia/Seoul' });
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/settings/schedule',
        { timezone: 'Asia/Seoul' },
        { queueOfflineMutation: false },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Use Asia/Seoul' })).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Times above are read in Asia/Seoul.')).toBeInTheDocument();
  });
});
