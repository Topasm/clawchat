import { IS_CAPACITOR, IS_ANDROID } from '../types/platform';

export async function initCapacitor(): Promise<void> {
  if (!IS_CAPACITOR) return;

  const { StatusBar, Style } = await import('@capacitor/status-bar');
  await StatusBar.setStyle({ style: Style.Dark });
  if (IS_ANDROID) await StatusBar.setBackgroundColor({ color: '#0f0f0f' });

  const { App } = await import('@capacitor/app');
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) window.history.back();
    else App.exitApp();
  });
  App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) window.dispatchEvent(new CustomEvent('app:resume'));
  });
}
