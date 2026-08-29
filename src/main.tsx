import { StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './app/i18n';
import { markStartupPhase, markStartupPhaseAfterPaint } from './app/services/startupPerformance';
import { useAuthStore } from './app/stores/useAuthStore';
import './styles/index.css';
import App from './App';
import { installGlobalErrorHandlers, scheduleStartupTimeout } from './app/services/startupSurface';

markStartupPhase('renderer_module_loaded');
installGlobalErrorHandlers();
scheduleStartupTimeout();
void import('./app/services/runtimePerformance').then(({ installRuntimePerformance }) => {
  installRuntimePerformance();
});

markStartupPhase('platform_ready');

function StartupShellGuard({ children }: { children: ReactNode }) {
  const isLoading = useAuthStore((state) => state.isLoading);

  useEffect(() => {
    return markStartupPhaseAfterPaint('react_root_committed');
  }, []);

  useEffect(() => {
    if (!isLoading) markStartupPhase('auth_ready');
  }, [isLoading]);

  return children;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <StartupShellGuard>
      <App />
    </StartupShellGuard>
  </StrictMode>,
);
