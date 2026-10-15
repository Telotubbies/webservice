// ErrorBoundary (v4 T12) — one render crash must never blank the console.
// Three layers:
//   <ErrorBoundary>      class boundary; `resetKey` change clears the error
//   <RouteBoundary>      per-route wrapper keyed on pathname — crash shows the
//                        recovery block inside the shell, nav keeps working
//   <RouteError>         router errorElement — last resort for crashes that
//                        escape a boundary (boot, lazy-chunk failures)

import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useRouteError } from 'react-router';
import { Icon } from './Icon';

export function CrashState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="error-state" role="alert">
      <Icon name="warn" size={28} />
      <h3>{t('errors.crashed')}</h3>
      <p>{t('errors.crashedBody')}</p>
      <button className="btn btn-sm" onClick={onRetry}>
        <Icon name="refresh" size={16} /> {t('common.retry')}
      </button>
    </div>
  );
}

interface BoundaryProps { children: ReactNode; resetKey?: string }
interface BoundaryState { err: Error | null }

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { err: null };

  static getDerivedStateFromError(err: Error): BoundaryState {
    return { err };
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (this.state.err && prev.resetKey !== this.props.resetKey) {
      this.setState({ err: null });
    }
  }

  render() {
    if (this.state.err) {
      return <CrashState onRetry={() => this.setState({ err: null })} />;
    }
    return this.props.children;
  }
}

/** Per-route boundary — a crash in one page leaves the shell + nav alive;
 *  navigating away (or retrying) resets it. */
export function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundary resetKey={pathname}>{children}</ErrorBoundary>;
}

/** Router-level errorElement — errors that escape every boundary (auth boot,
 *  lazy chunk load failures) land here instead of a blank page. */
export function RouteError() {
  const err = useRouteError();
  const detail = err instanceof Error ? err.message : undefined;
  void detail; // kept for diagnostics; the UI stays user-safe
  return (
    <div className="page">
      <CrashState onRetry={() => window.location.assign('/')} />
    </div>
  );
}

