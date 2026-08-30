import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './app/config/ThemeProvider';
import { queryClient } from './app/config/queryClient';
import { initializeQueryCachePersistence } from './app/config/queryCachePersistence';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import AppRuntimeServices from './app/components/app-shell/AppRuntimeServices';
import { useTranslation } from './app/i18n';
import AppRouter from './router';
import { initializeUpdateLifecycle } from './app/services/updateLifecycle';

initializeQueryCachePersistence();

export default function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    initializeUpdateLifecycle();
  }, []);

  return (
    <ErrorBoundary name="App">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <AppRuntimeServices />
            <AppRouter key={i18n.language} />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
