import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeAppLanguage } from '../../../i18n';
import {
  clearDebugLogs,
  getDebugSnapshot,
  recordDebug,
  setDebugLogging,
} from '../../../services/debugLogging';
import DebugLoggingSection from '../DebugLoggingSection';

vi.mock('../../../platform', () => ({
  platformApi: { runtime: { os: 'linux', appVersion: 'test', kind: 'tauri' } },
}));
beforeEach(async () => {
  await changeAppLanguage('en');
  setDebugLogging(false);
  clearDebugLogs();
});
afterEach(() => {
  cleanup();
  setDebugLogging(false);
  clearDebugLogs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('debug controls', () => {
  it('copies a portable report with OS and application version', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    setDebugLogging(true);
    render(<DebugLoggingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostic logs' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
      runtime: { os: 'linux', appVersion: 'test' },
    });
  });

  it('offers a JSON download and releases its temporary object URL', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue('blob:diagnostics');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    setDebugLogging(true);
    render(<DebugLoggingSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Export diagnostic logs' }));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(document.querySelector('a[download]')).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:diagnostics');
  });
  it('shows new logs immediately, stops capturing and clears without logging its own controls', () => {
    render(<DebugLoggingSection />);
    fireEvent.click(screen.getByRole('switch', { name: 'Capture diagnostic logs' }));
    expect(screen.getByText('Live capture is on')).toBeInTheDocument();
    act(() => recordDebug({ event: 'response', resource: 'todos', status: 503 }));
    expect(screen.getByLabelText('Diagnostic log')).toHaveTextContent('503');
    fireEvent.click(screen.getByRole('switch'));
    act(() => recordDebug({ event: 'response', status: 418 }));
    expect(screen.getByLabelText('Diagnostic log')).not.toHaveTextContent('418');
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Clear diagnostic logs' }));
    expect(getDebugSnapshot().entries).toHaveLength(0);
  });
});
