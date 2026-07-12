import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LockKeyhole, UserRound, Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { TngTile } from './TngLogo';

type Step = 'name' | 'pin-login' | 'pin-setup-new' | 'pin-setup-confirm';

export function LoginScreen() {
  const { registerUser, loginUser, users, registrationOpen } = useAuth();

  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('name');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const knownUsers = Object.values(users).sort((a, b) =>
    (b.lastLoginAt ?? b.createdAt).localeCompare(a.lastLoginAt ?? a.createdAt),
  );

  const submitName = (rawName?: string) => {
    const value = (rawName ?? name).trim();
    if (!value) {
      setError('Bitte gib deinen Namen ein.');
      return;
    }
    setName(value);
    setError(null);
    setPin('');
    // Selbst-Registrierung nur im Bootstrap (erstes Konto). Sonst direkt Login.
    setStep(registrationOpen ? 'pin-setup-new' : 'pin-login');
  };

  const handlePinComplete = async (entered: string) => {
    if (step === 'pin-login') {
      setBusy(true);
      const res = await loginUser(name, entered);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        setPin('');
        return;
      }
    } else if (step === 'pin-setup-new') {
      setPin(entered);
      setError(null);
      setStep('pin-setup-confirm');
    } else if (step === 'pin-setup-confirm') {
      if (entered !== pin) {
        setError('PINs stimmen nicht überein. Bitte erneut versuchen.');
        setPin('');
        setStep('pin-setup-new');
        return;
      }
      setBusy(true);
      const res = await registerUser(name, entered);
      setBusy(false);
      if (!res.ok) {
        setError(res.error);
        setPin('');
        setStep('pin-setup-new');
        return;
      }
    }
  };

  const goBack = () => {
    setError(null);
    setPin('');
    setStep('name');
  };

  const isPinStep = step === 'pin-login' || step === 'pin-setup-new' || step === 'pin-setup-confirm';

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <TngTile size={64} radius={16} />
          <div>
            <div className="login-title">Stadtnetz CRM</div>
            <div className="login-subtitle">TNG Stadtnetz GmbH</div>
          </div>
        </div>

        <div key={step} className="login-step-wrap">
          {step === 'name' && (
            <NameStep
              name={name}
              onNameChange={setName}
              onSubmit={() => submitName()}
              knownUsers={knownUsers.map((u) => u.displayName)}
              onPickKnown={(n) => {
                setName(n);
                submitName(n);
              }}
              error={error}
              registrationOpen={registrationOpen}
            />
          )}

          {isPinStep && (
            <PinStep
              mode={step as 'pin-login' | 'pin-setup-new' | 'pin-setup-confirm'}
              name={name}
              error={error}
              busy={busy}
              onComplete={handlePinComplete}
              onBack={goBack}
            />
          )}
        </div>

        <div className="login-footer">
          <Sparkles size={11} />
          TNG Stadtnetz GmbH · Vertriebssystem
        </div>
      </div>
    </div>
  );
}

function NameStep({
  name,
  onNameChange,
  onSubmit,
  knownUsers,
  onPickKnown,
  error,
  registrationOpen,
}: {
  name: string;
  onNameChange: (v: string) => void;
  onSubmit: () => void;
  knownUsers: string[];
  onPickKnown: (n: string) => void;
  error: string | null;
  registrationOpen: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <>
      <div className="login-step-title">
        {registrationOpen ? 'Erstes Konto einrichten' : 'Willkommen'}
      </div>
      <div className="login-step-sub">
        {registrationOpen
          ? 'Noch kein Konto vorhanden. Lege das erste an — es wird automatisch zum Chef-Zugang.'
          : 'Gib deinen Namen ein, um dich anzumelden.'}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="login-form"
      >
        <label className="login-field">
          <UserRound size={15} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Dein Name (z. B. Max)"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            autoComplete="username"
            maxLength={32}
          />
        </label>

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="login-primary" disabled={!name.trim()}>
          Weiter <ArrowRight size={15} />
        </button>
      </form>

      {knownUsers.length > 0 && (
        <div className="login-known">
          <div className="login-known-label">Zuletzt angemeldet</div>
          <div className="login-known-chips">
            {knownUsers.slice(0, 6).map((n) => (
              <button
                key={n}
                type="button"
                className="login-chip"
                onClick={() => onPickKnown(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      {!registrationOpen && (
        <div className="login-hint">
          Neue Konten werden von der Chefin/dem Chef angelegt.
        </div>
      )}
    </>
  );
}

function PinStep({
  mode,
  name,
  error,
  busy,
  onComplete,
  onBack,
}: {
  mode: 'pin-login' | 'pin-setup-new' | 'pin-setup-confirm';
  name: string;
  error: string | null;
  busy: boolean;
  onComplete: (pin: string) => void;
  onBack: () => void;
}) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '']);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  const setDigit = (i: number, v: string) => {
    const clean = v.replace(/\D/g, '').slice(-1);
    setDigits((d) => {
      const next = [...d];
      next[i] = clean;
      if (clean && i < 3) inputs.current[i + 1]?.focus();
      if (next.every((x) => x !== '')) {
        const pin = next.join('');
        setTimeout(() => onComplete(pin), 80);
      }
      return next;
    });
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus();
    }
    if (e.key === 'ArrowLeft' && i > 0) inputs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 3) inputs.current[i + 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (text.length === 0) return;
    e.preventDefault();
    const next = ['', '', '', ''];
    for (let i = 0; i < text.length; i++) next[i] = text[i];
    setDigits(next);
    if (text.length === 4) setTimeout(() => onComplete(text), 80);
    else inputs.current[text.length]?.focus();
  };

  const title =
    mode === 'pin-login'
      ? 'PIN eingeben'
      : mode === 'pin-setup-new'
        ? 'PIN festlegen'
        : 'PIN bestätigen';

  const sub =
    mode === 'pin-login' ? (
      <>
        Hallo <strong>{name}</strong> – gib deine 4-stellige PIN ein.
      </>
    ) : mode === 'pin-setup-new' ? (
      <>
        Neuer Account für <strong>{name}</strong>. Wähle eine 4-stellige PIN.
      </>
    ) : (
      <>Bitte zur Sicherheit nochmal eingeben.</>
    );

  return (
    <>
      <div className="login-step-title">
        <LockKeyhole size={16} style={{ marginRight: 8, verticalAlign: '-3px' }} />
        {title}
      </div>
      <div className="login-step-sub">{sub}</div>

      <div className="pin-row">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              inputs.current[i] = el;
            }}
            className={`pin-digit${d ? ' pin-digit--filled' : ''}`}
            value={d ? '•' : ''}
            onChange={(e) => {
              const raw = e.target.value.replace(/[•\s]/g, '');
              setDigit(i, raw);
            }}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={2}
            aria-label={`Ziffer ${i + 1}`}
            disabled={busy}
          />
        ))}
      </div>

      {busy && (
        <div className="login-busy">
          <Loader2 size={16} className="spin" />
          <span>Verbinde …</span>
        </div>
      )}
      {!busy && error && <div className="login-error">{error}</div>}

      <div className="login-actions">
        <button type="button" className="login-secondary" onClick={onBack} disabled={busy}>
          {mode === 'pin-login' ? 'Zurück' : 'Anderer Name'}
        </button>
      </div>
    </>
  );
}
