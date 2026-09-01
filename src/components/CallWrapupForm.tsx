import { type ReactNode, useId, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Phone, ShieldAlert } from 'lucide-react';
import { Modal } from './Modal';
import {
  BUILDING_DETAIL_FIELDS,
  BUILDING_TYPES,
  CONTACT_WINDOW,
  DOI_CHANNELS,
  DOI_RETENTION_YEARS,
  DOI_STATUS,
  FRAUD_MARKERS,
  HOME_ID_KINDS,
  LEGITIMATION_METHODS,
  TRISTATE,
  WINBACK_STATUS,
  buildWrapupPatch,
  campaignFor,
  catalogOf,
  detectHomeIdKind,
  isWithinContactWindow,
  missingRequirements,
  normalizeHomeId,
  outcomeOf,
  outcomesFor,
  validateHomeId,
  wrapupFromCall,
  type CatalogEntry,
} from '../lib/campaigns';
import type { Call, CallWrapup, Campaign, CampaignCallType, DoiChannel, DoiStatus, HomeIdKind } from '../types';

interface Props {
  call: Call;
  /** Kampagne des Anrufs — bestimmt Leitfaden, Ergebnisse und Pflichtfelder. */
  campaign?: Campaign;
  onClose: () => void;
  onSave: (patch: ReturnType<typeof buildWrapupPatch>) => Promise<void> | void;
}

/**
 * Gesprächsdokumentation nach Gesprächsleitfaden v2.0.
 *
 * Das Formular ist nicht fest verdrahtet, sondern baut sich aus dem
 * Kampagnen-Katalog (src/lib/campaigns.ts): welches Ergebnis gewählt wurde,
 * bestimmt, welche Felder erscheinen und welche davon Pflicht sind. Ein neuer
 * Ablehnungsgrund im Katalog ist damit eine Zeile dort — nicht eine Änderung
 * hier.
 *
 * Die Leitfäden markieren mehrere Punkte als vergütungsrelevant. Deshalb ist
 * die Vollständigkeit kein Hinweis, sondern eine Bedingung: solange
 * Pflichtangaben fehlen, ist das Speichern gesperrt und der Grund benannt.
 * Die Alternative — speichern lassen und später mahnen — hieße, dass genau die
 * Fälle unvollständig bleiben, an denen die Vergütung hängt.
 */
export function CallWrapupForm({ call, campaign, onClose, onSave }: Props) {
  const fid = useId();
  const callType: CampaignCallType = campaign?.callType ?? 'churn';
  const conf = campaignFor(callType);

  const [wrapup, setWrapup] = useState<CallWrapup>(() => wrapupFromCall(call));
  const [outcomeId, setOutcomeId] = useState<string>(call.outcomeCode ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const outcomes = useMemo(() => outcomesFor(callType, call.direction), [callType, call.direction]);
  const chosen = outcomeId ? outcomeOf(callType, outcomeId) : null;
  const missing = useMemo(
    () => (outcomeId ? missingRequirements(callType, outcomeId, wrapup) : []),
    [callType, outcomeId, wrapup],
  );

  const set = (patch: Partial<CallWrapup>) => {
    setWrapup((w) => ({ ...w, ...patch }));
    setError('');
  };

  /** Ein Feld zeigen, wenn es Pflicht ist, schon befüllt wurde — oder auf Wunsch. */
  const shows = (field: string) =>
    showAll || Boolean(chosen?.requires?.includes(field)) || hasValue(wrapup[field]);

  const homeIdCheck = wrapup.homeId
    ? validateHomeId(String(wrapup.homeId), String(wrapup.homeIdKind ?? detectHomeIdKind(String(wrapup.homeId))?.id ?? ''))
    : null;

  const save = async () => {
    if (!outcomeId) {
      setError('Bitte ein Gesprächsergebnis wählen.');
      return;
    }
    if (missing.length > 0) {
      setError(`Noch offen: ${missing.map((m) => m.label).join(', ')}`);
      return;
    }
    if (homeIdCheck && !homeIdCheck.ok) {
      setError(`HomeID: ${homeIdCheck.reason}`);
      return;
    }
    setSaving(true);
    try {
      await onSave(buildWrapupPatch(callType, outcomeId, wrapup));
      onClose();
    } catch (e) {
      setSaving(false);
      setError(e instanceof Error ? e.message : 'Speichern fehlgeschlagen.');
    }
  };

  const outsideWindow = !isWithinContactWindow(new Date(call.startedAt));

  return (
    <Modal
      open
      onClose={onClose}
      title="Gespräch dokumentieren"
      subtitle={`${conf.title} · Leitfaden v${conf.version} (${conf.stand})`}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>
            Abbrechen
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !outcomeId || missing.length > 0}
          >
            {saving ? 'Speichert…' : 'Erfassung abschließen'}
          </button>
        </>
      }
    >
      <div className="wrapup">
        {/* Rahmen des Anrufs: Rufnummernanzeige und Zeitfenster stehen in jedem
            Leitfaden unter „Vor dem Anruf" — hier als Beleg, nicht als Regel,
            denn das Gespräch ist bereits gelaufen. */}
        <div className="wrapup-context">
          <span>
            <Phone size={12} /> Rufnummernanzeige: {conf.callerId}
          </span>
          <span className={outsideWindow ? 'wrapup-context-warn' : ''}>
            {outsideWindow ? <AlertTriangle size={12} /> : <Info size={12} />}
            {outsideWindow
              ? `Außerhalb des zulässigen Fensters (${CONTACT_WINDOW.label})`
              : CONTACT_WINDOW.label}
          </span>
          <span>Doku: {conf.systems.join(' · ').toUpperCase()}</span>
        </div>

        {conf.privacy?.hideOtherContractHolders && (
          <p className="wrapup-privacy">
            <ShieldAlert size={13} /> {conf.privacy.note}
          </p>
        )}

        {/* ── Ergebnis ─────────────────────────────────────────────────────── */}
        <section className="wrapup-section">
          <h4>Gesprächsergebnis</h4>
          <div className="wrapup-choices">
            {outcomes.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`wrapup-choice ${outcomeId === o.id ? 'is-active' : ''}`}
                onClick={() => {
                  setOutcomeId(o.id);
                  setError('');
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>

        {chosen && (
          <>
            {/* ── Legitimation ───────────────────────────────────────────── */}
            {shows('legitimation') && (
              <Field
                id={`${fid}-legit`}
                label="Legitimation"
                hint="Die Frage „Spreche ich mit …?“ ist Gesprächseinstieg, keine Legitimation."
                required={chosen.requires?.includes('legitimation')}
              >
                <ChoiceRow
                  options={LEGITIMATION_METHODS}
                  value={wrapup.legitimation}
                  onChange={(v) => set({ legitimation: v })}
                />
              </Field>
            )}

            {/* ── Widerruf oder Kündigung (nur Churn) ────────────────────── */}
            {conf.variants && shows('variant') && (
              <Field
                id={`${fid}-variant`}
                label="Widerruf oder Kündigung"
                hint="Bestimmt Frist, Wirkung und Winback-Chance."
                required={chosen.requires?.includes('variant')}
              >
                <ChoiceRow
                  options={conf.variants}
                  value={wrapup.variant as string | undefined}
                  onChange={(v) => set({ variant: v })}
                />
                {typeof wrapup.variant === 'string' && (
                  <p className="wrapup-note">
                    {text(conf.variants.find((v) => v.id === wrapup.variant)?.deadline)}
                  </p>
                )}
              </Field>
            )}

            {/* ── Winback ────────────────────────────────────────────────── */}
            {(shows('winbackReason') || shows('rejectionReason') || shows('winbackStatus')) && (
              <section className="wrapup-section">
                <h4>Winback</h4>
                {shows('winbackStatus') && (
                  <Field id={`${fid}-wbstatus`} label="Winback-Status" required>
                    <ChoiceRow
                      options={WINBACK_STATUS}
                      value={wrapup.winbackStatus ?? chosen.winbackStatus}
                      onChange={(v) => set({ winbackStatus: v as CallWrapup['winbackStatus'] })}
                    />
                    <p className="wrapup-note">
                      „Erfolgreich“ und „nicht erfolgreich“ nur mit Ursache — sonst bleibt der Fall
                      auf „offen“ und ist weder abrechenbar noch auswertbar.
                    </p>
                  </Field>
                )}
                {shows('winbackReason') && (
                  <Field
                    id={`${fid}-wbreason`}
                    label="Ursache"
                    hint="Warum wollte der Kunde gehen?"
                    required={chosen.requires?.includes('winbackReason')}
                  >
                    <ChoiceRow
                      options={catalogOf(callType, 'winbackReason')}
                      value={wrapup.winbackReason}
                      onChange={(v) => set({ winbackReason: v })}
                    />
                  </Field>
                )}
                {shows('rejectionReason') && (
                  <Field
                    id={`${fid}-reject`}
                    label="Ablehnungsgrund"
                    hint="Strukturiert erfassen — der Grund ist genauso wertvoll wie der gehaltene Kunde."
                    required={chosen.requires?.includes('rejectionReason')}
                  >
                    <ChoiceRow
                      options={catalogOf(callType, 'rejectionReason')}
                      value={wrapup.rejectionReason}
                      onChange={(v) => set({ rejectionReason: v })}
                    />
                  </Field>
                )}
                {shows('winbackMeasure') && (
                  <Field
                    id={`${fid}-measure`}
                    label="Vereinbarte Maßnahme"
                    hint="Nicht mit Stufe 3 einsteigen — wer sofort kompensiert, löst das Problem nicht."
                    required={chosen.requires?.includes('winbackMeasure')}
                  >
                    <ChoiceRow
                      options={catalogOf(callType, 'winbackMeasure')}
                      value={wrapup.winbackMeasure}
                      onChange={(v) => set({ winbackMeasure: v })}
                    />
                  </Field>
                )}
              </section>
            )}

            {/* ── Kampagnenspezifisch ────────────────────────────────────── */}
            <CampaignFields
              fid={fid}
              callType={callType}
              wrapup={wrapup}
              set={set}
              shows={shows}
              required={(f) => Boolean(chosen.requires?.includes(f))}
            />

            {/* ── Beratungsqualität (Welcome) ────────────────────────────── */}
            {conf.capturesAdviceScore && (
              <section className="wrapup-section">
                <h4>Beratungsqualität</h4>
                <Field
                  id={`${fid}-protocol`}
                  label="Beratungsprotokoll ausgehändigt?"
                  required={chosen.requires?.includes('adviceProtocol')}
                >
                  <ChoiceRow
                    options={[
                      { id: 'ja', label: 'Ja' },
                      { id: 'nein', label: 'Nein' },
                    ]}
                    value={
                      wrapup.adviceProtocol === undefined ? undefined : wrapup.adviceProtocol ? 'ja' : 'nein'
                    }
                    onChange={(v) => set({ adviceProtocol: v === 'ja' })}
                  />
                </Field>
                <Field
                  id={`${fid}-score`}
                  label="Beratungsnote"
                  hint="Schulnote 1–6. Bei 5 oder 6 die Begründung im Kommentar festhalten — ohne Wertung im Gespräch."
                  required={chosen.requires?.includes('adviceScore')}
                >
                  <div className="wrapup-scores">
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`wrapup-score ${wrapup.adviceScore === n ? 'is-active' : ''} ${n >= 5 ? 'is-bad' : ''}`}
                        onClick={() => set({ adviceScore: n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </Field>
              </section>
            )}

            {/* ── HomeID ─────────────────────────────────────────────────── */}
            <section className="wrapup-section">
              <h4>
                HomeID
                {conf.requiresHomeId && <span className="wrapup-req">Pflicht</span>}
              </h4>
              <p className="wrapup-note">
                Reihenfolge: ausgewiesene HomeID vor ONT-Seriennummer vor AD-Nummer. 0/O und 1/I sind
                die häufigsten Verwechslungen — Nummer wiederholen und bestätigen lassen.
              </p>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor={`${fid}-homeid`}>Nummer</label>
                  <input
                    id={`${fid}-homeid`}
                    value={String(wrapup.homeId ?? '')}
                    placeholder="z.B. NE422224WS52"
                    onChange={(e) => {
                      const value = normalizeHomeId(e.target.value);
                      // Art mitführen statt raten lassen: die Datenbank lehnt
                      // eine Nummer ohne Art ab, und die Rangfolge ist der
                      // ganze Punkt der Erhebung.
                      set({ homeId: value, homeIdKind: detectHomeIdKind(value)?.id ?? wrapup.homeIdKind });
                    }}
                    aria-invalid={Boolean(homeIdCheck && !homeIdCheck.ok)}
                  />
                  {homeIdCheck && !homeIdCheck.ok && (
                    <div className="field-warning">{homeIdCheck.reason}</div>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={`${fid}-homeidkind`}>Art</label>
                  <select
                    id={`${fid}-homeidkind`}
                    value={String(wrapup.homeIdKind ?? '')}
                    onChange={(e) => set({ homeIdKind: (e.target.value || undefined) as HomeIdKind })}
                  >
                    <option value="">— wählen —</option>
                    {HOME_ID_KINDS.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label} ({k.example})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <CheckRow
                id={`${fid}-homeidok`}
                checked={Boolean(wrapup.homeIdConfirmed)}
                onChange={(v) => set({ homeIdConfirmed: v })}
                label="Nummer wiederholt und vom Kunden bestätigt"
              />
            </section>

            {/* ── Double-Opt-In ──────────────────────────────────────────── */}
            <section className="wrapup-section">
              <h4>
                Double-Opt-In Permission
                <span className="wrapup-req">Pflicht</span>
              </h4>
              <p className="wrapup-note">
                Wird in jedem positiven oder neutralen Gesprächsabschluss angekündigt — ohne Ausnahme.
                Werblich angesprochen werden darf erst nach der Bestätigung des Kunden (§ 7 Abs. 2 UWG);
                der Nachweis ist {DOI_RETENTION_YEARS} Jahre aufzubewahren (§ 7a UWG).
              </p>
              <Field id={`${fid}-doi`} label="Stand" required>
                <ChoiceRow
                  options={DOI_STATUS}
                  value={wrapup.doi}
                  onChange={(v) => set({ doi: v as DoiStatus })}
                />
              </Field>
              <Field id={`${fid}-doichannels`} label="Kontaktarten" hint="Werden getrennt erfasst.">
                <div className="wrapup-choices">
                  {DOI_CHANNELS.map((c) => {
                    const active = (wrapup.doiChannels ?? []).includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`wrapup-choice ${active ? 'is-active' : ''}`}
                        onClick={() =>
                          set({
                            doiChannels: active
                              ? (wrapup.doiChannels ?? []).filter((x) => x !== c.id)
                              : [...(wrapup.doiChannels ?? []), c.id as DoiChannel],
                          })
                        }
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </section>

            {/* ── Fraud ──────────────────────────────────────────────────── */}
            {conf.capturesFraud && (
              <section className="wrapup-section">
                <h4>Fraud-Verdacht</h4>
                <p className="wrapup-note">
                  Wir dokumentieren Beobachtungen, keine Bewertungen — der Verdacht wird nie im Gespräch
                  benannt. Erst die Zuordnung zum aufnehmenden Vertriebspartner macht aus Einzelfällen
                  ein Frühwarnsignal.
                </p>
                <CheckRow
                  id={`${fid}-fraud`}
                  checked={Boolean(wrapup.fraudSuspicion)}
                  onChange={(v) => set({ fraudSuspicion: v })}
                  label="Mindestens ein Merkmal beobachtet"
                />
                {wrapup.fraudSuspicion && (
                  <>
                    <div className="wrapup-markers">
                      {groupBy(FRAUD_MARKERS, (m) => m.group).map(([group, items]) => (
                        <div key={group}>
                          <span className="wrapup-markers-head">{group}</span>
                          {items.map((m) => {
                            const active = (wrapup.fraudMarkers ?? []).includes(m.id);
                            return (
                              <CheckRow
                                key={m.id}
                                id={`${fid}-fm-${m.id}`}
                                checked={active}
                                onChange={() =>
                                  set({
                                    fraudMarkers: active
                                      ? (wrapup.fraudMarkers ?? []).filter((x) => x !== m.id)
                                      : [...(wrapup.fraudMarkers ?? []), m.id],
                                  })
                                }
                                label={m.label}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="form-grid">
                      <div className="field">
                        <label htmlFor={`${fid}-partner`}>Aufnehmender Vertriebspartner</label>
                        <input
                          id={`${fid}-partner`}
                          value={String(wrapup.salesPartner ?? '')}
                          onChange={(e) => set({ salesPartner: e.target.value })}
                          placeholder="Name oder Partner-Kennung"
                        />
                      </div>
                      <div className="field full">
                        <label htmlFor={`${fid}-fraudnote`}>Beobachtung (wertfrei)</label>
                        <textarea
                          id={`${fid}-fraudnote`}
                          rows={2}
                          value={String(wrapup.fraudNote ?? '')}
                          onChange={(e) => set({ fraudNote: e.target.value })}
                          placeholder="Was der Kunde gesagt hat — wörtlich, ohne Spekulation."
                        />
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}

            {/* ── Abschluss-Check & Kommentar ────────────────────────────── */}
            <section className="wrapup-section">
              <h4>Abschluss-Check</h4>
              <p className="wrapup-note">
                Dokumentation nach dem 4-W-Standard: Wer hat angerufen, was wurde besprochen, welche
                Maßnahme wurde vereinbart, wann ist der nächste Schritt fällig. Ganze Sätze, sachlich
                und wertfrei — der Kunde hat ein Auskunftsrecht nach Art. 15 DSGVO.
              </p>
              {conf.checklist.map((item) => {
                // Nur die Haken zeigen, die es als erfassbares Feld gibt. Die
                // übrigen Punkte stehen im Leitfaden und sind dort besser
                // aufgehoben als als unklickbare Zeile hier.
                const isConfirm = confirmableFields.has(item.id);
                if (!isConfirm) return null;
                return (
                  <CheckRow
                    key={item.id}
                    id={`${fid}-cl-${item.id}`}
                    checked={Boolean(wrapup[item.id])}
                    onChange={(v) => set({ [item.id]: v })}
                    label={item.label}
                    required={item.required}
                    hint={item.hint}
                  />
                );
              })}
              <div className="field full">
                <label htmlFor={`${fid}-note`}>Kommentar</label>
                <textarea
                  id={`${fid}-note`}
                  rows={3}
                  value={String(wrapup.note ?? '')}
                  onChange={(e) => set({ note: e.target.value })}
                  placeholder={chosen.seed}
                />
              </div>
            </section>

            <button type="button" className="wrapup-toggle" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Nur Pflichtfelder zeigen' : 'Alle Felder der Kampagne zeigen'}
            </button>
          </>
        )}

        {/* ── Status ─────────────────────────────────────────────────────── */}
        {outcomeId && (
          <div className={`wrapup-status ${missing.length === 0 ? 'is-ok' : 'is-open'}`}>
            {missing.length === 0 ? (
              <>
                <CheckCircle2 size={14} /> Erfassung vollständig — abrechenbar.
              </>
            ) : (
              <>
                <AlertTriangle size={14} />
                <div>
                  <strong>Noch offen ({missing.length}):</strong>
                  <ul>
                    {missing.map((m) => (
                      <li key={m.id}>
                        {m.label}
                        {m.hint && <span className="muted"> — {m.hint}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        )}

        {error && <div className="field-error">{error}</div>}
      </div>
    </Modal>
  );
}

/**
 * Die Felder, die nur je einer Kampagne gehören. Bewusst als eigene Komponente:
 * das Hauptformular bleibt so lesbar, und wer den Dubletten-Check ändert, muss
 * den Postrückläufer nicht anfassen.
 */
function CampaignFields({
  fid,
  callType,
  wrapup,
  set,
  shows,
  required,
}: {
  fid: string;
  callType: CampaignCallType;
  wrapup: CallWrapup;
  set: (patch: Partial<CallWrapup>) => void;
  shows: (field: string) => boolean;
  required: (field: string) => boolean;
}) {
  const conf = campaignFor(callType);

  if (callType === 'prl') {
    return (
      <section className="wrapup-section">
        <h4>Postrückläufer</h4>
        {shows('prlCause') && (
          <Field
            id={`${fid}-prlcause`}
            label="Ursache des Rückläufers"
            hint="Wer nur „Adresse geändert“ dokumentiert, produziert den nächsten Rückläufer."
            required={required('prlCause')}
          >
            <ChoiceRow
              options={catalogOf(callType, 'prlCause')}
              value={wrapup.prlCause as string | undefined}
              onChange={(v) => set({ prlCause: v })}
            />
            {typeof wrapup.prlCause === 'string' && (
              <p className="wrapup-note">
                {text(catalogOf(callType, 'prlCause').find((c) => c.id === wrapup.prlCause)?.action)}
              </p>
            )}
          </Field>
        )}
        <CheckRow
          id={`${fid}-resend`}
          checked={Boolean(wrapup.resendTriggered)}
          onChange={(v) => set({ resendTriggered: v })}
          label="Erneuter Versand veranlasst und dem Kunden angekündigt"
          required={required('resendTriggered')}
        />
        <CheckRow
          id={`${fid}-mailok`}
          checked={Boolean(wrapup.emailConfirmed)}
          onChange={(v) => set({ emailConfirmed: v })}
          label="E-Mail-Adresse buchstabieren lassen, bestätigt und als Zustellweg angeboten"
          required={required('emailConfirmed')}
        />
      </section>
    );
  }

  if (callType === 'dupe') {
    const type = wrapup.buildingType as string | undefined;
    const needsDetails = Boolean(BUILDING_TYPES.find((b) => b.id === type)?.details);
    const wiringForbidden = ((conf.rules?.wiringRequiredForbiddenFor as string[]) ?? []).includes(type ?? '');
    return (
      <section className="wrapup-section">
        <h4>Gebäude & Dublette</h4>
        <Field
          id={`${fid}-btype`}
          label="Gebäudetyp"
          hint="„Wie viele Haushalte gibt es bei Ihnen im Haus?“ — diese eine Frage entscheidet alles Weitere."
          required={required('buildingType')}
        >
          <ChoiceRow options={BUILDING_TYPES} value={type} onChange={(v) => set({ buildingType: v })} />
        </Field>

        {needsDetails && (
          <div className="form-grid">
            {BUILDING_DETAIL_FIELDS.map((f) => (
              <div className={`field ${f.type === 'text' || f.type === 'choice' ? 'full' : ''}`} key={f.id}>
                <label htmlFor={`${fid}-bd-${f.id}`}>{f.label}</label>
                {f.type === 'tristate' ? (
                  <ChoiceRow
                    options={TRISTATE}
                    value={wrapup[f.id] as string | undefined}
                    onChange={(v) => set({ [f.id]: v })}
                  />
                ) : f.type === 'choice' ? (
                  <>
                    <ChoiceRow
                      options={(f.options ?? []).map((o) => ({
                        id: o,
                        label: o === 'eigenleistung' ? 'Eigenleistung des Eigentümers' : 'Noch erforderlich',
                      }))}
                      value={wrapup[f.id] as string | undefined}
                      onChange={(v) => set({ [f.id]: v })}
                    />
                    {wiringForbidden && wrapup[f.id] === 'erforderlich' && (
                      <div className="field-error">
                        Bei SDU 2 ist „erforderlich“ nicht zulässig — die Umsetzung im Haus liegt beim
                        Eigentümer. Bei Ablehnung Gutschein bis 3 × 50 € (nur reaktiv, nach Rücksprache).
                      </div>
                    )}
                  </>
                ) : (
                  <input
                    id={`${fid}-bd-${f.id}`}
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={String(wrapup[f.id] ?? '')}
                    onChange={(e) => set({ [f.id]: e.target.value })}
                    placeholder={f.question}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {shows('dupeReason') && (
          <Field
            id={`${fid}-dupereason`}
            label="Begründung der Entscheidung"
            hint="Ein Vertrag bleibt immer bestehen — wir bereinigen die Dublette, wir stornieren nicht beide."
            required={required('dupeReason')}
          >
            <ChoiceRow
              options={catalogOf(callType, 'dupeReason')}
              value={wrapup.dupeReason as string | undefined}
              onChange={(v) => set({ dupeReason: v })}
            />
          </Field>
        )}
        <CheckRow
          id={`${fid}-second`}
          checked={Boolean(wrapup.secondPartyHandled)}
          onChange={(v) => set({ secondPartyHandled: v })}
          label="Zweiter Vertragsnehmer einbezogen oder informiert"
          required={required('secondPartyHandled')}
          hint="Keine Auskunft über den jeweils anderen Vertrag."
        />
        {shows('jiraComponent') && <JiraComponentField fid={fid} callType={callType} wrapup={wrapup} set={set} required={required('jiraComponent')} />}
      </section>
    );
  }

  if (callType === 'bvw') {
    return (
      <section className="wrapup-section">
        <h4>Bauverweigerung</h4>
        {shows('bvwTypology') && (
          <Field
            id={`${fid}-typ`}
            label="Ursache der Verweigerung"
            hint="Die Zuständigkeit entscheidet über die Lösung."
            required={required('bvwTypology')}
          >
            <ChoiceRow
              options={catalogOf(callType, 'bvwTypology')}
              value={wrapup.bvwTypology as string | undefined}
              onChange={(v) => set({ bvwTypology: v })}
            />
            {typeof wrapup.bvwTypology === 'string' && (
              <p className="wrapup-note">
                {text(catalogOf(callType, 'bvwTypology').find((t) => t.id === wrapup.bvwTypology)?.approach)}
              </p>
            )}
          </Field>
        )}
        {shows('buildCondition') && (
          <div className="field full">
            <label htmlFor={`${fid}-cond`}>
              Ausbaubedingung{required('buildCondition') && <span className="wrapup-req">Pflicht</span>}
            </label>
            <textarea
              id={`${fid}-cond`}
              rows={2}
              value={String(wrapup.buildCondition ?? '')}
              onChange={(e) => set({ buildCondition: e.target.value })}
              placeholder="Wörtlich: was der Kunde konkret braucht, damit gebaut werden darf."
            />
          </div>
        )}
        {shows('contactPerson') && (
          <div className="field full">
            <label htmlFor={`${fid}-contact`}>
              Ansprechpartner{required('contactPerson') && <span className="wrapup-req">Pflicht</span>}
            </label>
            <input
              id={`${fid}-contact`}
              value={String(wrapup.contactPerson ?? '')}
              onChange={(e) => set({ contactPerson: e.target.value })}
              placeholder="Name, Telefon, E-Mail — auch Eigentümer oder Hausverwaltung"
            />
          </div>
        )}
        <Field id={`${fid}-solutions`} label="Eingesetzte Lösungen" hint="Immer ein Angebot mitliefern, nie nur die Konsequenz benennen.">
          <div className="wrapup-choices">
            {catalogOf(callType, 'solution').map((s) => {
              const list = (wrapup.solutions as string[] | undefined) ?? [];
              const active = list.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className={`wrapup-choice ${active ? 'is-active' : ''}`}
                  title={s.needsApproval ? 'Nur nach Rücksprache' : undefined}
                  onClick={() =>
                    set({ solutions: active ? list.filter((x) => x !== s.id) : [...list, s.id] })
                  }
                >
                  {s.label}
                  {s.needsApproval ? ' *' : ''}
                </button>
              );
            })}
          </div>
          <p className="wrapup-note">* nur nach Rücksprache. Der Gutschein wird nie unaufgefordert angekündigt.</p>
        </Field>
        {shows('contractValid') && (
          <Field
            id={`${fid}-valid`}
            label="Vertragsgültigkeit geprüft"
            hint={`Ohne VZF-Genehmigung oder mit Restlaufzeit unter ${String(conf.rules?.minRemainingMonthsForLetter ?? 7)} Monaten: direkt an AMA und Storno — kein Anschreiben.`}
            required={required('contractValid')}
          >
            <ChoiceRow
              options={[
                { id: 'gueltig', label: 'Gültig — Anschreiben möglich' },
                { id: 'ungueltig', label: 'Nicht mehr gültig — AMA & Storno' },
              ]}
              value={wrapup.contractValid as string | undefined}
              onChange={(v) => set({ contractValid: v })}
            />
          </Field>
        )}
        {shows('jiraComponent') && <JiraComponentField fid={fid} callType={callType} wrapup={wrapup} set={set} required={required('jiraComponent')} />}
        {shows('followUpAt') && (
          <div className="field">
            <label htmlFor={`${fid}-fu`}>
              Arbeitsbeginn / Wiedervorlage{required('followUpAt') && <span className="wrapup-req">Pflicht</span>}
            </label>
            <input
              id={`${fid}-fu`}
              type="date"
              value={String(wrapup.followUpAt ?? '')}
              onChange={(e) => set({ followUpAt: e.target.value })}
            />
            <div className="field-warning">
              Nach dem Anschreiben auf in {String(conf.timing.followUpDays ?? 14)} Tagen setzen — ohne
              Arbeitsbeginn taucht das Ticket in keinem Filter auf.
            </div>
          </div>
        )}
      </section>
    );
  }

  if (callType === 'courtesy') {
    return (
      <section className="wrapup-section">
        <h4>Inbetriebnahme</h4>
        <CheckRow
          id={`${fid}-connid`}
          checked={Boolean(wrapup.connectionId)}
          onChange={(v) => set({ connectionId: v })}
          label="Anschluss-ID abgeglichen, bevor über den Anschluss gesprochen wurde"
          required={required('connectionId')}
        />
        {shows('courtesyIssue') && (
          <Field
            id={`${fid}-issue`}
            label="Beobachtetes Problem"
            hint="Wörtlich aufnehmen, nicht interpretieren."
            required={required('courtesyIssue')}
          >
            <ChoiceRow
              options={catalogOf(callType, 'courtesyIssue')}
              value={wrapup.courtesyIssue as string | undefined}
              onChange={(v) => set({ courtesyIssue: v })}
            />
            {typeof wrapup.courtesyIssue === 'string' && (
              <p className="wrapup-note">
                Weitergabe an:{' '}
                {text(catalogOf(callType, 'courtesyIssue').find((i) => i.id === wrapup.courtesyIssue)?.target)}
              </p>
            )}
          </Field>
        )}
        <Field id={`${fid}-fault`} label="Fehlerbild" hint="Hilft beim Ticket — was der Kunde sieht, und die wahrscheinliche Ursache.">
          <ChoiceRow
            options={catalogOf(callType, 'fault')}
            value={wrapup.fault as string | undefined}
            onChange={(v) => set({ fault: v })}
          />
          {typeof wrapup.fault === 'string' && (
            <p className="wrapup-note">
              {text(catalogOf(callType, 'fault').find((f) => f.id === wrapup.fault)?.cause)}
            </p>
          )}
        </Field>
        {shows('language') && (
          <div className="field">
            <label htmlFor={`${fid}-lang`}>
              Muttersprache{required('language') && <span className="wrapup-req">Pflicht</span>}
            </label>
            <input
              id={`${fid}-lang`}
              value={String(wrapup.language ?? '')}
              onChange={(e) => set({ language: e.target.value })}
              placeholder="In welcher Sprache der Rückruf erfolgen sollte"
            />
            <div className="field-warning">
              Ein abgebrochener Call bedeutet einen nicht aktivierten Anschluss — nie einfach auflegen.
            </div>
          </div>
        )}
      </section>
    );
  }

  return null;
}

function JiraComponentField({
  fid,
  callType,
  wrapup,
  set,
  required,
}: {
  fid: string;
  callType: CampaignCallType;
  wrapup: CallWrapup;
  set: (patch: Partial<CallWrapup>) => void;
  required: boolean;
}) {
  const options = catalogOf(callType, 'jiraComponent');
  return (
    <Field
      id={`${fid}-jira`}
      label="JIRA-Komponente"
      hint="Ohne sie erscheint das Ticket in keinem Filter und der Vorgang bleibt liegen."
      required={required}
    >
      <ChoiceRow
        options={options}
        value={wrapup.jiraComponent as string | undefined}
        onChange={(v) => set({ jiraComponent: v })}
      />
      {typeof wrapup.jiraComponent === 'string' && (
        <p className="wrapup-note">{text(options.find((o) => o.id === wrapup.jiraComponent)?.hint)}</p>
      )}
    </Field>
  );
}

// ── Kleinteile ──────────────────────────────────────────────────────────────

function Field({
  id,
  label,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field full" id={id}>
      {/* Bewusst kein <label>: die Gruppen darunter sind Knopfleisten, kein
          einzelnes Eingabefeld — ein label ohne Control wäre für Screenreader
          irreführend. */}
      <span className="field-label">
        {label}
        {required && <span className="wrapup-req">Pflicht</span>}
      </span>
      {children}
      {hint && <p className="wrapup-note">{hint}</p>}
    </div>
  );
}

function ChoiceRow({
  options,
  value,
  onChange,
}: {
  options: CatalogEntry[];
  value?: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="wrapup-choices">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`wrapup-choice ${value === o.id ? 'is-active' : ''}`}
          title={typeof o.hint === 'string' ? o.hint : undefined}
          // Erneutes Klicken hebt die Wahl auf — sonst ließe sich eine
          // versehentlich gesetzte Pflichtangabe nur durch Abbrechen lösen.
          onClick={() => onChange(value === o.id ? '' : o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CheckRow({
  id,
  checked,
  onChange,
  label,
  required,
  hint,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <label className="wrapup-check" htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {required && <span className="wrapup-req">Pflicht</span>}
        {hint && <span className="wrapup-note inline"> {hint}</span>}
      </span>
    </label>
  );
}

/** Bestätigungshaken aus dem Abschluss-Check — Ja/Nein, kein Wert. */
const confirmableFields = new Set([
  'auftragsverifikation',
  // adviceProtocol fehlt hier bewusst: es wird im Abschnitt Beratungsqualität
  // als Ja/Nein erfasst und stünde hier ein zweites Mal.
  'dataCheck',
  'decision',
  'addressComplete',
  'activation',
  'buildingDetails',
  'wiring',
  'documentation',
  'measures',
  'hardware',
  'escalation',
  'dupeDecision',
  'confirmationSent',
]);

/** Katalog-Zusatzfeld als Text — `unknown` aus dem Katalog wird sonst zu „undefined“. */
function text(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

function groupBy<T>(items: T[], key: (item: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return Array.from(map.entries());
}
