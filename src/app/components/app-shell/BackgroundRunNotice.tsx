import { useEffect, useState } from 'react';
import { useTheme } from '../../config/ThemeContext';
import { themeCssVars } from '../../config/themeCssVars';
import { translateUi } from '../../i18n';
import { platformApi } from '../../platform';
import { logger } from '../../services/logger';

export const BACKGROUND_NOTICE_STORAGE_KEY = 'cc-background-run-notice-shown';

function noticeAlreadyShown(): boolean {
  try {
    return localStorage.getItem(BACKGROUND_NOTICE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberNoticeShown(): void {
  try {
    localStorage.setItem(BACKGROUND_NOTICE_STORAGE_KEY, '1');
  } catch {
    // Without storage the notice may repeat; that is better than never showing it.
  }
}

export function backgroundQuitHint(os: string): string {
  return os === 'macos'
    ? translateUi('To quit, choose Quit ClawChat from the menu-bar icon or press ⌘Q.')
    : translateUi('To quit, choose Quit ClawChat from the tray icon menu.');
}

/**
 * Closing the window only hides it while ClawChat keeps serving in the
 * background. The first time that happens, say so -- as a system notification
 * while the window is gone, and on screen when it comes back.
 */
export default function BackgroundRunNotice() {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const { isDesktop, os } = platformApi.runtime;

  useEffect(() => {
    if (!isDesktop) return;
    return platformApi.events.on('main-window-hidden', () => {
      if (noticeAlreadyShown()) return;
      rememberNoticeShown();
      setVisible(true);
      void platformApi.notifications
        .show(translateUi('ClawChat is still running'), backgroundQuitHint(os), { silent: true })
        .catch((error) => logger.warn('Could not show the background notice', error));
    });
  }, [isDesktop, os]);

  if (!visible) return null;
  return (
    <div
      className="cc-background-notice"
      role="status"
      aria-live="polite"
      style={themeCssVars(colors)}
    >
      <div className="cc-background-notice__body">
        <strong>{translateUi('ClawChat keeps running in the background')}</strong>
        <span>
          {translateUi(
            'Closing the window hides it, so your workspace stays available to your other devices and agents.',
          )}{' '}
          {backgroundQuitHint(os)}
        </span>
      </div>
      <button
        type="button"
        className="cc-btn cc-btn--secondary cc-btn--compact"
        onClick={() => setVisible(false)}
      >
        {translateUi('Got it')}
      </button>
    </div>
  );
}
