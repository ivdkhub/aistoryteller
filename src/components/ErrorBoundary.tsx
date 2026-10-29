import { Component, type ReactNode } from 'react';

/** Se una pagina va in errore mostra cosa è successo invece di una finestra vuota. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('AI Story Teller:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="empty">
          <p className="empty-title">Questa pagina non si è caricata</p>
          <p>{this.state.error.message}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => this.setState({ error: null })}>
              Riprova
            </button>
            <button className="btn btn-primary" onClick={() => window.location.assign('/')}>
              Torna alla panoramica
            </button>
          </div>
        </div>
      </div>
    );
  }
}
