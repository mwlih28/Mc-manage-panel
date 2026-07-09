import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCw, Copy } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

// App-wide safety net: a render-time exception anywhere below this boundary
// would otherwise white-screen the whole panel with nothing but a blank page
// and a console error the user can't see. This catches it and shows a
// branded, actionable fallback (reload, or copy the stack to paste into a
// bug report) instead. Must be a class component — React only supports error
// boundaries via componentDidCatch / getDerivedStateFromError.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    // Still surface it to the console for anyone with devtools open / for any
    // future error-reporting hook to pick up.
    // eslint-disable-next-line no-console
    console.error('Uncaught render error:', error, info);
  }

  handleCopy = () => {
    const { error, info } = this.state;
    const text = `${error?.name}: ${error?.message}\n\n${error?.stack || ''}\n\n${info?.componentStack || ''}`;
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: '#0B0C0E' }}>
        <div className="w-full max-w-md rounded-2xl border p-8 text-center" style={{ background: '#131417', borderColor: '#1C1E22' }}>
          <div className="mx-auto mb-4 w-12 h-12 rounded-xl flex items-center justify-center bg-red-500/10 text-red-400">
            <AlertTriangle size={22} />
          </div>
          <h1 className="text-lg font-semibold text-white">Something went wrong</h1>
          <p className="text-sm text-zinc-500 mt-2">
            The page hit an unexpected error. Reloading usually fixes it — if it keeps happening,
            copy the details below and send them to your panel administrator.
          </p>

          {this.state.error.message && (
            <pre className="mt-4 text-left text-[11px] font-mono text-zinc-500 bg-black/30 border border-zinc-800 rounded-lg p-3 max-h-32 overflow-auto">
              {this.state.error.message}
            </pre>
          )}

          <div className="flex items-center justify-center gap-2 mt-5">
            <button onClick={() => window.location.reload()} className="btn-primary btn-sm">
              <RotateCw size={13} /> Reload page
            </button>
            <button onClick={this.handleCopy} className="btn-secondary btn-sm">
              <Copy size={13} /> Copy details
            </button>
          </div>
        </div>
      </div>
    );
  }
}
