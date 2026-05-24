import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../lib/errorReporting';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Render-Fehler ab, damit die App nicht in einen weißen Bildschirm
 * kippt. Zeigt eine freundliche Fehlerseite mit Neuladen-Knopf und meldet
 * den Fehler an die zentrale Fehler-Erfassung (Sentry-ready).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="boot-screen" role="alert">
        <div className="error-boundary-card">
          <div className="error-boundary-title">Da ist etwas schiefgelaufen</div>
          <div className="error-boundary-sub">
            Die Ansicht konnte nicht geladen werden. Deine Daten sind sicher
            gespeichert. Lade die App neu, um weiterzuarbeiten.
          </div>
          <button
            type="button"
            className="login-primary"
            onClick={() => window.location.reload()}
          >
            App neu laden
          </button>
        </div>
      </div>
    );
  }
}
