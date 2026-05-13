import { useState } from 'react';
import { Database, ArrowRight, AlertCircle, ExternalLink } from 'lucide-react';
import { setSupabaseConfig } from '../lib/supabase';
import { TngTile } from './TngLogo';

/**
 * First-Run Setup-Screen: User trägt Supabase URL + Anon-Key ein.
 * Nach dem Speichern wird die Seite neu geladen, damit der Client
 * mit der neuen Config initialisiert wird.
 */
export function SupabaseSetup() {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const cleanUrl = url.trim().replace(/\/$/, '');
    const cleanKey = anonKey.trim();

    if (!cleanUrl || !cleanKey) {
      setError('Beide Felder ausfüllen.');
      return;
    }
    try {
      new URL(cleanUrl);
    } catch {
      setError('URL ist ungültig.');
      return;
    }
    if (!cleanUrl.includes('supabase.co') && !cleanUrl.includes('supabase')) {
      setError('Das sieht nicht nach einer Supabase-URL aus.');
      return;
    }
    if (cleanKey.length < 40) {
      setError('Anon-Key ist zu kurz.');
      return;
    }

    setSupabaseConfig({ url: cleanUrl, anonKey: cleanKey });
    // Reload, damit der Auth-Listener mit dem neuen Client startet
    window.location.reload();
  };

  return (
    <div className="login-shell">
      <div className="login-bg-orb login-bg-orb-1" />
      <div className="login-bg-orb login-bg-orb-2" />

      <div className="login-card" style={{ maxWidth: 520 }}>
        <div className="login-brand">
          <TngTile size={64} radius={16} />
          <div>
            <div className="login-title">Stadtnetz CRM</div>
            <div className="login-subtitle">Backend einrichten</div>
          </div>
        </div>

        <div className="login-step-title" style={{ fontSize: 18 }}>
          <Database size={16} style={{ marginRight: 8, verticalAlign: '-3px' }} />
          Mit Supabase verbinden
        </div>
        <div className="login-step-sub">
          Damit alle Kolleg:innen die gleichen Daten sehen, brauchen wir ein
          gemeinsames Backend. Trag einmal die Zugangsdaten eures Supabase-Projekts ein.
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="login-form"
        >
          <label className="login-field">
            <span className="setup-label">Project URL</span>
            <input
              type="url"
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="login-field">
            <span className="setup-label">Anon / Public Key</span>
            <input
              type="text"
              placeholder="eyJhbGciOi..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />
          </label>

          {error && (
            <div className="login-error">
              <AlertCircle size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />
              {error}
            </div>
          )}

          <button type="submit" className="login-primary">
            Verbinden <ArrowRight size={15} />
          </button>
        </form>

        <div className="setup-hint">
          <div className="setup-hint-title">Erstmal einrichten?</div>
          <ol>
            <li>
              <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
                supabase.com/dashboard <ExternalLink size={11} />
              </a>{' '}
              öffnen → neues Projekt anlegen
            </li>
            <li>
              In <code>SQL Editor</code> die Datei <code>db/schema.sql</code> aus
              dem Repo komplett ausführen
            </li>
            <li>
              <strong>Authentication → Providers → Email</strong> öffnen und
              „Confirm email" deaktivieren (wir nutzen Namen statt Email)
            </li>
            <li>
              Project Settings → API → <code>URL</code> und{' '}
              <code>anon public</code> Key hier eintragen
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
}
