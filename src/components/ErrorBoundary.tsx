import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What to render instead of the crashed subtree. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  /** When any of these change, the boundary resets (e.g. switching channels). */
  resetKeys?: unknown[];
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Contains rendering errors so one bad message (or panel) can't unmount the whole app —
 * otherwise a single malformed event would crash Matterix every time its channel opens.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Render error contained by ErrorBoundary:", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !sameKeys(prev.resetKeys, this.props.resetKeys)) this.setState({ error: null });
  }

  reset = () => this.setState({ error: null });

  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

function sameKeys(a?: unknown[], b?: unknown[]) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => Object.is(v, b[i]));
}

/** Fallback for a single message. */
export function BrokenMessage() {
  return (
    <div className="post">
      <div className="post-gutter" />
      <div className="post-main muted small">⚠ This message couldn't be displayed.</div>
    </div>
  );
}

/** Fallback for a whole panel (channel view, thread, sidebar…). */
export function BrokenPanel({ error, reset, what }: { error: Error; reset: () => void; what: string }) {
  return (
    <div className="broken-panel">
      <h3>Something went wrong showing {what}.</h3>
      <p className="muted small">{error.message}</p>
      <button className="btn-secondary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
