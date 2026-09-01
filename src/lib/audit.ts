import { insertAuditLog } from './supabaseApi';
import { useAuth } from '../store/useAuth';
import type { AuditAction, AuditEntity } from '../types';

/**
 * Schreibt einen Audit-Log-Eintrag für die aktuelle Aktion des angemeldeten
 * Nutzers. Fehler beim Loggen blockieren niemals die eigentliche Operation,
 * sondern landen nur in der Konsole. Wenn kein Nutzer angemeldet ist, wird der
 * Eintrag verworfen (RLS würde ihn ohnehin ablehnen).
 *
 * Gibt das Promise zurück, damit Aufrufer, die dem Schreibvorgang die
 * Berechtigung unter den Füßen wegziehen, darauf warten können — konkret der
 * Logout: die RLS-Policy verlangt `actor_id = auth.uid()`, und nach signOut()
 * ist auth.uid() null. Ohne await lief der Eintrag ins Leere (42501), das
 * Audit-Log enthielt deshalb ausschließlich Logins, nie ein Logout. Alle
 * anderen Aufrufer dürfen das Promise weiterhin ignorieren.
 *
 * DSGVO Art. 30: Verzeichnis von Verarbeitungstätigkeiten — wer hat wann was
 * auf welcher personenbezogenen Datenquelle verändert.
 */
export function logAudit(params: {
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: string;
  entityLabel?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const user = useAuth.getState().getCurrentUser();
  if (!user) return Promise.resolve();

  return insertAuditLog({
    actorId: user.key,
    actorName: user.displayName,
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    entityLabel: params.entityLabel,
    details: params.details,
  }).catch((e) => {
    // Wir loggen den Fehler, schlucken ihn aber — das Audit-Log darf nie
    // den Nutzer-Flow blockieren.
    console.warn('[audit] log failed:', e instanceof Error ? e.message : e);
  });
}
