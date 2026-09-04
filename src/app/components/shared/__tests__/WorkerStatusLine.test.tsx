import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useWorkerStore } from '../../../stores/useWorkerStore';
import WorkerStatusLine from '../WorkerStatusLine';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), isDesktop: true }));

vi.mock('../../../hooks/usePlatform', () => ({
  default: () => ({ isDesktop: mocks.isDesktop, isMobile: false }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mocks.navigate };
});

function renderLine() {
  return render(
    <MemoryRouter initialEntries={['/today']}>
      <WorkerStatusLine />
    </MemoryRouter>,
  );
}

describe('WorkerStatusLine', () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.isDesktop = true;
    useWorkerStore.getState().reset();
    useSettingsStore.setState({ workerEnabled: true, workerLabel: 'ubuntu-lab' });
  });

  it('says nothing where this machine cannot run work', () => {
    useSettingsStore.setState({ workerEnabled: false });
    const { container, unmount } = renderLine();
    expect(container).toBeEmptyDOMElement();
    unmount();

    useSettingsStore.setState({ workerEnabled: true });
    mocks.isDesktop = false;
    expect(renderLine().container).toBeEmptyDOMElement();
  });

  it('moves from connecting to idle to the job it is running', () => {
    renderLine();
    expect(screen.getByText(/This machine: ubuntu-lab · Connecting…/)).toBeInTheDocument();

    act(() => useWorkerStore.getState().setRegistered('host-1', 'ubuntu-lab'));
    expect(screen.getByText(/ubuntu-lab · Idle/)).toBeInTheDocument();

    act(() => useWorkerStore.getState().setBusy('run-1', 'E65a seed sweep'));
    expect(screen.getByText(/Running E65a seed sweep/)).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveClass('cc-worker-status--busy');

    act(() => useWorkerStore.getState().setBusy(null));
    expect(screen.getByText(/ubuntu-lab · Idle/)).toBeInTheDocument();
  });

  it('opens the worker section of Settings', () => {
    renderLine();
    fireEvent.click(screen.getByRole('button'));
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/settings#this-machine',
      expect.objectContaining({ state: expect.anything() }),
    );
  });
});
