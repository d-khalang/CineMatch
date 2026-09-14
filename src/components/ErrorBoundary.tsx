import { Component, ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // In production, we log a sanitized error without any potential credentials
    console.error('ErrorBoundary caught rendering exception:', error.message);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleResetUI = (): void => {
    // Clear temporary volatile recommendation caches, but strictly preserve ratings & watchlist
    try {
      localStorage.removeItem('cinematch_cached_recs_v2');
      sessionStorage.clear();
    } catch {
      // ignore
    }
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-canvas,#121c17)] text-[var(--text-primary,#ffffff)]">
          <div className="max-w-md w-full bg-[var(--bg-surface,#182620)] border border-[var(--border-subtle,#2a3f35)] rounded-2xl p-6 sm:p-8 space-y-5 shadow-2xl text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Something Went Wrong</h1>
              <p className="text-sm text-neutral-400">
                An unexpected rendering error occurred. Your saved ratings and watchlists remain safely preserved in storage.
              </p>
            </div>

            {this.state.error && (
              <div className="text-left text-xs bg-black/40 p-3 rounded-lg border border-white/5 font-mono text-neutral-400 overflow-x-auto max-h-32">
                {this.state.error.message}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={this.handleReload}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-primary,#10b981)] hover:brightness-110 text-black font-semibold text-sm transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                Reload Application
              </button>

              <button
                onClick={this.handleResetUI}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium text-sm transition-all border border-white/10"
              >
                <Trash2 className="w-4 h-4" />
                Reset UI State
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
