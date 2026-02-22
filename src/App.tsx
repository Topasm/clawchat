import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from './app/config/ThemeProvider';
import { queryClient } from './app/config/queryClient';
import ErrorBoundary from './app/components/shared/ErrorBoundary';
import AppRouter from './router';

export default function App() {
  return (
    <ErrorBoundary name="App">
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
