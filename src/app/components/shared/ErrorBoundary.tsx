import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../../services/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const label = this.props.name ?? 'Unknown';
    logger.error(`ErrorBoundary [${label}] caught an error`, error, {
      componentStack: info.componentStack ?? '',
    });
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="cc-error-boundary">
        <div className="cc-error-boundary__icon" aria-hidden="true">!</div>
        <h2 className="cc-error-boundary__title">Something went wrong</h2>
        <p className="cc-error-boundary__message">
          {this.state.error?.message || 'An unexpected error occurred.'}
        </p>
        <button
          type="button"
          className="cc-btn cc-btn--primary cc-error-boundary__btn"
          onClick={this.handleReset}
        >
          Try again
        </button>
      </div>
    );
  }
}
