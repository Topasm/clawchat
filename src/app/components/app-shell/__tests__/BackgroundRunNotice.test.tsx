import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtime: { kind: 'tauri', os: 'windows', appVersion: '1.4.43', isDesktop: true },
  listeners: new Map<string, () => void>(),
  show: vi.fn(),
}));

vi.mock('../../../platform', () => ({
  platformApi: {
    runtime: mocks.runtime,
    events: {
      on: (channel: string, callback: () => void) => {
        mocks.listeners.set(channel, callback);
        return () => mocks.listeners.delete(channel);
      },
    },
    notifications: { show: mocks.show, setBadgeCount: vi.fn() },
  },
}));

vi.mock('../../../config/ThemeContext', () => ({
  useTheme: () => ({ colors: {}, isDark: false }),
}));

const { default: BackgroundRunNotice, BACKGROUND_NOTICE_STORAGE_KEY } =
  await import('../BackgroundRunNotice');

function hideWindow() {
  act(() => mocks.listeners.get('main-window-hidden')?.());
}

beforeEach(() => {
  localStorage.clear();
  mocks.listeners.clear();
  mocks.show.mockReset();
  mocks.show.mockResolvedValue(undefined);
  mocks.runtime.os = 'windows';
  mocks.runtime.isDesktop = true;
});

describe('BackgroundRunNotice', () => {
  it('explains on the first close that ClawChat keeps running and how to quit', () => {
    render(<BackgroundRunNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    hideWindow();

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('ClawChat keeps running in the background');
    expect(notice).toHaveTextContent('choose Quit ClawChat from the tray icon menu');
    expect(mocks.show).toHaveBeenCalledWith(
      'ClawChat is still running',
      'To quit, choose Quit ClawChat from the tray icon menu.',
      { silent: true },
    );
    expect(localStorage.getItem(BACKGROUND_NOTICE_STORAGE_KEY)).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says it only once', () => {
    localStorage.setItem(BACKGROUND_NOTICE_STORAGE_KEY, '1');
    render(<BackgroundRunNotice />);

    hideWindow();

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(mocks.show).not.toHaveBeenCalled();
  });

  it('points to the menu bar and Command-Q on macOS', () => {
    mocks.runtime.os = 'macos';
    render(<BackgroundRunNotice />);

    hideWindow();

    expect(screen.getByRole('status')).toHaveTextContent('menu-bar icon or press ⌘Q');
  });

  it('does not listen outside the desktop app', () => {
    mocks.runtime.isDesktop = false;
    render(<BackgroundRunNotice />);
    expect(mocks.listeners.has('main-window-hidden')).toBe(false);
  });
});
