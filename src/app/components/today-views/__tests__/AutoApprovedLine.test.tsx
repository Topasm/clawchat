import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewItemResponse } from '../../../types/api';
import AutoApprovedLine from '../AutoApprovedLine';

const mocks = vi.hoisted(() => ({ reviews: vi.fn(), updateJob: vi.fn(), navigate: vi.fn() }));

vi.mock('../../../hooks/queries', () => ({
  useReviewsQuery: mocks.reviews,
  useUpdateScheduledJob: () => ({ mutate: mocks.updateJob, isPending: false }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

function item(overrides: Partial<ReviewItemResponse>): ReviewItemResponse {
  return {
    id: 'review-1',
    subject_type: 'agent_run',
    subject_title: 'Course notices digest',
    subject_href: '/chats/conv-1',
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    review_note: 'Approved automatically',
    metadata: {
      conversation_id: 'conv-1',
      automation: {
        scheduled_job_id: 'sjob-1',
        title: 'Course notices',
        auto_approve_low_risk: true,
        offer_skip_review: true,
        auto_approved: true,
      },
    },
    ...overrides,
  } as ReviewItemResponse;
}

function renderLine() {
  return render(
    <MemoryRouter>
      <AutoApprovedLine />
    </MemoryRouter>,
  );
}

describe('AutoApprovedLine', () => {
  beforeEach(() => {
    mocks.updateJob.mockReset();
    mocks.navigate.mockReset();
  });

  it('is silent when nothing was approved without asking today', () => {
    mocks.reviews.mockReturnValue({
      data: [
        item({ review_note: null, metadata: { automation: { scheduled_job_id: 'sjob-1' } } }),
        item({ id: 'review-old', reviewed_at: '2020-01-01T00:00:00Z' }),
      ],
    });
    expect(renderLine().container).toBeEmptyDOMElement();
  });

  it('counts what skipped review, opens it, and turns the skipping off in place', () => {
    mocks.reviews.mockReturnValue({ data: [item({}), item({ id: 'review-2' })] });
    renderLine();
    expect(screen.getByText('Approved without asking · 2 · Course notices')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    // No panel in this test, so the thread opens as a page.
    expect(mocks.navigate).toHaveBeenCalledWith('/chats/conv-1');
    fireEvent.click(screen.getByRole('button', { name: 'Ask next time' }));
    expect(mocks.updateJob).toHaveBeenCalledWith({
      id: 'sjob-1',
      changes: { auto_approve_low_risk: false },
    });
  });
});
