import { Check, X } from 'lucide-react';
import { useSwaps } from '../store/useSwaps';
import { swapSummary } from '../lib/notifications';
import type { ShiftSwapRequest } from '../types';

/**
 * Die Knöpfe an einer Tauschanfrage — im Postfach an der Meldung, im
 * Schichtplan an der Übersicht offener Anfragen. Eine Stelle für beide, damit
 * niemand an zwei Orten unterschiedliche Handlungen angeboten bekommt.
 *
 * Welche Knöpfe erscheinen, hängt daran, wer schaut und wie weit die Anfrage
 * ist: jede Rolle sieht genau den Schritt, der von ihr erwartet wird, und
 * sonst nur den Stand.
 */
export function SwapActions({
  swap,
  myId,
  manager,
}: {
  swap: ShiftSwapRequest;
  myId: string;
  manager: boolean;
}) {
  const busy = useSwaps((s) => s.busy);
  const accept = useSwaps((s) => s.accept);
  const decline = useSwaps((s) => s.decline);
  const cancel = useSwaps((s) => s.cancel);
  const approve = useSwaps((s) => s.approve);
  const reject = useSwaps((s) => s.reject);

  const isPartner = swap.partnerId === myId;
  const isRequester = swap.requesterId === myId;

  // Angenommen und ich bin Chef: bestätigen. Auch dann, wenn ich selbst
  // beteiligt bin — sonst bliebe der Tausch liegen, sobald der Chef mittauscht.
  if (swap.status === 'accepted' && manager) {
    return (
      <div className="postfach-actions">
        <span className="postfach-actions-hint">{swapSummary(swap)}</span>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void approve(swap.id)}>
          <Check size={13} /> Tausch bestätigen
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => void reject(swap.id)}>
          Ablehnen
        </button>
      </div>
    );
  }

  if (swap.status === 'pending' && isPartner) {
    return (
      <div className="postfach-actions">
        <span className="postfach-actions-hint">{swapSummary(swap)}</span>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void accept(swap.id)}>
          <Check size={13} /> Annehmen
        </button>
        <button className="btn btn-sm" disabled={busy} onClick={() => void decline(swap.id)}>
          <X size={13} /> Ablehnen
        </button>
      </div>
    );
  }

  if (swap.status === 'pending' && isRequester) {
    return (
      <div className="postfach-actions">
        <span className="postfach-actions-hint">Wartet auf Antwort</span>
        <button className="btn btn-sm" disabled={busy} onClick={() => void cancel(swap.id)}>
          Zurückziehen
        </button>
      </div>
    );
  }

  // Angenommen, aber ich bin weder Chef noch sonst am Zug: nur der Stand.
  if (swap.status === 'accepted') {
    return (
      <div className="postfach-actions">
        <span className="postfach-actions-hint">
          Angenommen — wartet auf die Bestätigung durch den Chef.
        </span>
      </div>
    );
  }

  return null;
}
