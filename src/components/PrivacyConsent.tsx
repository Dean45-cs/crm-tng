import { useState } from 'react';
import { Shield, CheckCircle2, Database, Eye, Trash2, Loader2 } from 'lucide-react';
import { useAuth } from '../store/useAuth';

/**
 * DSGVO Art. 13 Informationspflicht — wird beim ersten Login einmalig
 * angezeigt. Nutzer:in muss aktiv bestätigen, dass die Hinweise zur
 * Kenntnis genommen wurden, bevor die App nutzbar wird.
 */
export function PrivacyConsent() {
  const { giveConsent, getCurrentUser } = useAuth();
  const user = getCurrentUser();
  const [busy, setBusy] = useState(false);

  const handleAccept = async () => {
    setBusy(true);
    await giveConsent();
    setBusy(false);
  };

  return (
    <div className="consent-backdrop" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="consent-modal">
        <div className="consent-header">
          <div className="consent-icon">
            <Shield size={28} />
          </div>
          <div>
            <h2 id="consent-title" className="consent-title">Datenschutzhinweis</h2>
            <div className="consent-sub">
              Bitte einmalig zur Kenntnis nehmen — gemäß Art. 13 DSGVO
            </div>
          </div>
        </div>

        <div className="consent-body">
          <p className="consent-intro">
            Willkommen{user ? `, ${user.displayName}` : ''}! Damit du das CRM nutzen kannst,
            informieren wir dich kurz darüber, welche Daten verarbeitet werden.
          </p>

          <div className="consent-section">
            <div className="consent-section-head">
              <Database size={15} />
              <span>Welche Daten werden verarbeitet?</span>
            </div>
            <ul>
              <li><strong>Kundendaten:</strong> Kundenname, Kundennummer, Telefon, Vertragsdaten, Tarifwechsel, Notizen.</li>
              <li><strong>Mitarbeiterdaten:</strong> Anzeige-Name, Anmelde-Zeitpunkt, Aktivitäts-/Provisionsdaten, Rolle.</li>
              <li><strong>Aktivitätsdaten:</strong> Anlegen, Ändern und Löschen von Datensätzen wird im Audit-Log gespeichert.</li>
            </ul>
          </div>

          <div className="consent-section">
            <div className="consent-section-head">
              <Eye size={15} />
              <span>Wer hat Zugriff?</span>
            </div>
            <ul>
              <li>Alle Mitarbeiter:innen der Vertriebs-Mannschaft sehen Verträge, Tarifwechsel und Notizen.</li>
              <li>Das Audit-Log ist <strong>ausschließlich</strong> für Chef-Accounts sichtbar.</li>
              <li>Daten werden bei Supabase (EU-Region) gespeichert; ein Auftragsverarbeitungsvertrag liegt vor.</li>
            </ul>
          </div>

          <div className="consent-section">
            <div className="consent-section-head">
              <Trash2 size={15} />
              <span>Deine Rechte</span>
            </div>
            <ul>
              <li>Recht auf Auskunft, Berichtigung, Löschung und Datenübertragbarkeit (Art. 15-20 DSGVO).</li>
              <li>Bei Fragen oder Anliegen wende dich an deine:n Vorgesetzte:n oder die TNG-Datenschutzbeauftragten.</li>
              <li>Kundendaten können auf Anfrage über die Kunden-Detailseite vollständig gelöscht werden.</li>
            </ul>
          </div>
        </div>

        <div className="consent-footer">
          <button
            type="button"
            className="consent-accept-btn"
            onClick={handleAccept}
            disabled={busy}
          >
            {busy ? (
              <>
                <Loader2 size={15} className="spin" /> Speichere …
              </>
            ) : (
              <>
                <CheckCircle2 size={15} /> Ich habe die Hinweise zur Kenntnis genommen
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
