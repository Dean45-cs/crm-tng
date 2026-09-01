import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  HOTKEYS,
  getStoredHotkeys,
  hotkeyConflict,
  hotkeyFromEvent,
  hotkeyLabel,
  onHotkeysChange,
  resetHotkeys,
  resolveHotkey,
  setHotkey,
  type HotkeyId,
  type HotkeyMap,
} from '../lib/hotkeys';

/**
 * Tastenkürzel der Web-App zum Selberbelegen.
 *
 * Die Zeilen kommen aus der Liste in lib/hotkeys.ts, nicht aus abgetipptem
 * Markup: ein neues Kürzel taucht damit von selbst hier auf, statt vergessen zu
 * werden.
 *
 * Aufnahme statt Textfeld: man drückt die Kombination, statt sie zu schreiben —
 * niemand tippt „Mod+Shift+K" fehlerfrei, und der Tastendruck ist ohnehin die
 * einzige Wahrheit darüber, was der Browser meldet.
 */
export function HotkeySettings() {
  const [map, setMap] = useState<HotkeyMap>(getStoredHotkeys);
  const [capturing, setCapturing] = useState<HotkeyId | ''>('');
  const [error, setError] = useState('');

  useEffect(() => onHotkeysChange(setMap), []);

  // Während der Aufnahme gehört jeder Tastendruck dieser Zeile. Sonst löste man
  // beim Belegen genau die Aktion aus, die man gerade umlegen will (⌘K neu
  // belegen hieße: Palette auf).
  useEffect(() => {
    if (!capturing) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setCapturing('');
        setError('');
        return;
      }
      // Rücktaste/Entf schaltet das Kürzel ab – ein eigener Zustand, kein
      // Zurückfallen auf die Voreinstellung.
      const binding = e.key === 'Backspace' || e.key === 'Delete' ? '' : hotkeyFromEvent(e);
      // Nur Zusatztasten gedrückt: weiter warten, das ist noch kein Kürzel.
      if (binding === '' && e.key !== 'Backspace' && e.key !== 'Delete') return;

      const clash = hotkeyConflict(capturing, binding, map);
      if (clash) {
        setError(`Schon belegt: ${HOTKEYS.find((h) => h.id === clash)?.label ?? clash}`);
        return;
      }
      setHotkey(capturing, binding);
      setMap(getStoredHotkeys());
      setCapturing('');
      setError('');
    };
    // capture: true, damit die Aufnahme vor allen anderen Zuhörern drankommt.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [capturing, map]);

  return (
    <div className="widget" style={{ marginBottom: 10 }}>
      <h3 className="widget-title">Tastenkürzel</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
        Anklicken und die gewünschte Kombination drücken. <strong>Esc</strong> bricht ab,{' '}
        <strong>Rücktaste</strong> schaltet ein Kürzel ganz aus. Gilt auf diesem Gerät.
      </p>

      {HOTKEYS.map((def) => {
        const binding = resolveHotkey(def.id, map);
        const isCapturing = capturing === def.id;
        return (
          <div className="hotkey-row" key={def.id}>
            <div className="hotkey-text">
              <strong>{def.label}</strong>
              <small>{def.hint}</small>
              {isCapturing && error && <small className="hotkey-error">{error}</small>}
            </div>
            <button
              type="button"
              className={`hotkey-key${isCapturing ? ' capturing' : ''}${binding ? '' : ' off'}`}
              onClick={() => {
                setCapturing(isCapturing ? '' : def.id);
                setError('');
              }}
              title="Anklicken und die gewünschte Tastenkombination drücken"
            >
              {isCapturing ? 'Taste drücken …' : binding ? hotkeyLabel(binding) : 'aus'}
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => {
                setHotkey(def.id, def.default);
                setMap(getStoredHotkeys());
              }}
              disabled={binding === def.default}
              title={`Auf ${hotkeyLabel(def.default)} zurücksetzen`}
              aria-label="Zurücksetzen"
            >
              <RotateCcw size={14} />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        className="btn-secondary"
        style={{ marginTop: 10 }}
        onClick={() => {
          resetHotkeys();
          setMap(getStoredHotkeys());
          setCapturing('');
          setError('');
        }}
      >
        Alle zurücksetzen
      </button>
    </div>
  );
}
