import { useEffect, useRef, useState } from 'react';
import { ArrowRight, LockKeyhole, UserRound, Sparkles } from 'lucide-react';
import { useAuth } from '../store/useAuth';
import { useStore } from '../store/useStore';
import { TngTile } from './TngLogo';

type Step = 'name' | 'pin-login' | 'pin-setup-new' | 'pin-setup-confirm';

export function LoginScreen() {
  const { hasUser, registerUser, loginUser, users } = useAuth();
  const { updateSettings } = useStore();

  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('name');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);

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
    setStep(hasUser(value) ? 'pin-login' : 'pin-setup-new');
  };

  const handlePinComplete = (entered: string) => {
    if (step === 'pin-login') {
      const res = loginUser(name, entered);
      if (!res.ok) {
        setError(res.error);
        setPin('');
        return;
      }
      updateSettings({ agentName: name.trim() });
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
      const res = registerUser(name, entered);
      if (!res.ok) {
        setError(res.error);
        setPin('');
        setStep('pin-setup-new');
        return;
      }
      updateSettings({ agentName: name.trim() });
    }
  };

  const goBack = () => {
    setError(null);
    setPin('');
    setStep('name');
  };

  return (
    <div className="login-shell">
      <div className="login-bg-orb login-bg-orb-1" />
      <div className="login-bg-orb login-bg-orb-2" />

      <div className="login-card">
        <div className="login-brand">
          <TngTile size={64} radius={16} />
          <div>
            <div className="login-title">Stadtnetz CRM</div>
            <div className="login-subtitle">TNG Stadtnetz GmbH · Ausbildung</div>
          </div>
        </div>

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
          />
        )}

        {step !== 'name' && (
          <PinStep
            key={step}
            mode={step}
            name={name}
            error={error}
            onComplete={handlePinComplete}
            onBack={goBack}
          />
        )}

        <div className="login-footer">
          <Sparkles size={11} />
          Alle Daten bleiben lokal auf diesem Gerät.
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
}: {
  name: string;
  onNameChange: (v: string) => void;
  onSubmit: () => void;
  knownUsers: string[];
  onPickKnown: (n: string) => void;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <>
      <div className="login-step-title">Willkommen</div>
      <div className="login-step-sub">
        Melde dich mit deinem Namen an. Beim ersten Mal vergibst du eine PIN.
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
    </>
  );
}

function PinStep({
  mode,
  name,
  error,
  onComplete,
  onBack,
}: {
  mode: 'pin-login' | 'pin-setup-new' | 'pin-setup-confirm';
  name: string;
  error: string | null;
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
            className="pin-digit"
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
          />
        ))}
      </div>

      {error && <div className="login-error">{error}</div>}

      <button type="button" className="login-secondary" onClick={onBack}>
        Anderer Name
      </button>
    </>
  );
}
