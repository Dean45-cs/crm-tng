import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Render-Fehler im gesamten Komponentenbaum ab, damit ein einzelner
 * Fehler nicht die ganze App in einen weißen Bildschirm reißt. Zeigt einen
 * freundlichen Hinweis mit Reload-Möglichkeit.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-icon">
            <AlertTriangle size={28} />
          </div>
          <h1>Etwas ist schiefgelaufen</h1>
          <p>
            Ein unerwarteter Fehler ist aufgetreten. Deine Daten sind sicher in
            der Cloud gespeichert – lade die Seite neu, um fortzufahren.
          </p>
          <button className="btn btn-primary" onClick={this.handleReload}>
            <RotateCcw size={14} /> Seite neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
