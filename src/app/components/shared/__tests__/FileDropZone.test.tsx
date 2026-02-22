import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FileDropZone from '../FileDropZone';

// Mock useAuthStore for isDemoMode
vi.mock('../../../stores/useAuthStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { serverUrl: string }) => unknown) => selector({ serverUrl: '' }),
    { getState: () => ({ serverUrl: '' }) },
  ),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('FileDropZone', () => {
  it('renders drop zone text', () => {
    renderWithProviders(<FileDropZone />);
    expect(screen.getByText('Drop files here or click to browse')).toBeInTheDocument();
  });

  it('shows accepted file type hints', () => {
    renderWithProviders(<FileDropZone />);
    expect(screen.getByText(/JPG, PNG, GIF/)).toBeInTheDocument();
    expect(screen.getByText(/Max 10MB/)).toBeInTheDocument();
  });
});
