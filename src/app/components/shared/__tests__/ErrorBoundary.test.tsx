import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

// Suppress console.error during intentional error tests
const originalError = console.error;
const suppressExpectedWindowError = (event: ErrorEvent) => event.preventDefault();
beforeEach(() => {
  console.error = vi.fn();
  window.addEventListener('error', suppressExpectedWindowError);
});
afterEach(() => {
  console.error = originalError;
  window.removeEventListener('error', suppressExpectedWindowError);
});

// Mock logger
vi.mock('../../../services/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function ThrowingComponent({ message }: { message: string }): never {
  throw new Error(message);
}

function GoodComponent() {
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('shows default fallback on error', () => {
    render(
      <ErrorBoundary name="Test">
        <ThrowingComponent message="boom" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('redacts sensitive details from the development fallback', () => {
    render(
      <ErrorBoundary name="PrivateFailure">
        <ThrowingComponent message="Bearer ui-secret at /Users/alice/private.ts" />
      </ErrorBoundary>,
    );

    expect(screen.queryByText(/ui-secret/)).not.toBeInTheDocument();
    expect(screen.queryByText(/alice/)).not.toBeInTheDocument();
    expect(screen.getByText(/\[redacted\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[local-path\]/)).toBeInTheDocument();
  });

  it('resets state when "Try again" is clicked', () => {
    let shouldThrow = true;

    function MaybeThrowing() {
      if (shouldThrow) throw new Error('test error');
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary name="ResetTest">
        <MaybeThrowing />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Fix the component, then click Try again
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error view</div>}>
        <ThrowingComponent message="fail" />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom error view')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });
});
