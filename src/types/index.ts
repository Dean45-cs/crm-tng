export type ContractStatus = 'offen' | 'aktiv' | 'storniert';

export type ProductCategory = 'Privat' | 'Business' | 'Zusatz';

export type ProductType =
  // Privat
  | 'Fibrelight'
  | 'Fibrefamily'
  | 'Fibrepro'
  | 'Flott50'
  | 'Flott300'
  | 'Flott500'
  | 'Surf100'
  | 'Surf1.000'
  | 'Smart300'
  | 'Smart1.000'
  | 'Family1.000'
  | 'Max.1.000'
  | 'Winback Privat'
  // Business
  | 'Lite 1000'
  | 'Basic 1000'
  | 'Pro 1000'
  | 'Premium 1000'
  | 'Winback Business'
  // Zusatz
  | 'Waipu TV'
  | 'Mobilfunk LTE Smart 4G'
  | 'Mobilfunk LTE Komplett 4G'
  | 'Mobilfunk LTE Smart 5G'
  | 'Mobilfunk LTE Komplett 5G';

export interface ProductInfo {
  name: ProductType;
  category: ProductCategory;
  commission: number;
}

export type TariffChangeType = 'sidegrade' | 'upgrade';
export type TariffContext = 'mvlz_gt3' | 'mvlz_lt3' | 'outside_mvlz';

export interface Contract {
  id: string;
  customerNumber: string;
  customerName: string;
  /** Ein Vertrag kann mehrere Produkte enthalten (Bundle-Verkauf) */
  products: ProductType[];
  contractDate: string;
  status: ContractStatus;
  jiraTicket: string;
  followUpDate?: string;
  /** Laufzeit in Monaten (12 oder 24). null = unbefristet. */
  laufzeitMonate?: 12 | 24 | null;
  notes?: string;
  createdAt: string;
  /** Key des angemeldeten Nutzers, der den Vertrag erfasst hat */
  createdBy?: string;
}

export interface TariffChange {
  id: string;
  customerNumber: string;
  customerName: string;
  changeType: TariffChangeType;
  context: TariffContext;
  oldProduct?: ProductType;
  newProduct?: ProductType;
  changeDate: string;
  jiraTicket: string;
  notes?: string;
  createdAt: string;
  /** Key des angemeldeten Nutzers, der den Wechsel erfasst hat */
  createdBy?: string;
  /** ISO-Zeitstempel, gesetzt nach erfolgreichem SharePoint-Export */
  exportedAt?: string;
}

export interface Note {
  id: string;
  customerNumber?: string;
  customerName?: string;
  title: string;
  content: string;
  jiraTicket?: string;
  createdAt: string;
  updatedAt: string;
  /** Key des angemeldeten Nutzers, der die Notiz erfasst hat */
  createdBy?: string;
}

export interface TariffCommissionMatrix {
  sidegrade: { mvlz_gt3: number; mvlz_lt3: number; outside_mvlz: number };
  upgrade: { mvlz_gt3: number; mvlz_lt3: number; outside_mvlz: number };
}

export interface Settings {
  products: ProductInfo[];
  tariffCommission: TariffCommissionMatrix;
  monthlyTarget: number;
  jiraBaseUrl: string;
  spClientId: string;
  spTenantId: string;
  spFilePath: string;
  spSheetName: string;
}

/** Abgeleitete Kunden-Aggregation aus den Daten */
export interface CustomerSummary {
  customerNumber: string;
  customerName: string;
  contractCount: number;
  tariffChangeCount: number;
  noteCount: number;
  totalCommission: number;
  lastActivity: string;
}

/** Eigenständige Kunden-Entität (Migration 017) – existiert auch ohne Vorgang */
export interface Customer {
  customerNumber: string;
  name: string;
  phone?: string;
  firstSeenAt: string;
  lastContactAt: string;
  createdBy?: string;

  // --- Aus der Gesprächserfassung nachgeführt (Migration 029) --------------
  // Erhoben wird im Gespräch, gehört aber zum Kunden: die Akte soll ohne
  // Durchsuchen der Anrufhistorie zeigen, ob eine HomeID vorliegt und ob
  // werblich angesprochen werden darf.

  /** Belastbarste bestätigte Kennung (HomeID vor ONT vor AD vor Genexis). */
  homeId?: string;
  homeIdKind?: HomeIdKind;
  homeIdAt?: string;
  /** Stand der Double-Opt-In Permission — werblich erst ab 'bestaetigt'. */
  doiStatus?: DoiStatus;
  doiConfirmedAt?: string;
  /** Einmal gesetzt, nicht durch einen späteren unauffälligen Anruf zurückgenommen. */
  fraudFlagged?: boolean;
}

/** Gesprächsergebnis, vom Abschluss-Panel der Extension gesetzt (Migration 021) */
export type CallDisposition = 'gehalten' | 'gekuendigt' | 'rueckruf' | 'kein-interesse' | 'sonstige';

/** Anruf-Historie (Migration 018) – von der Extension automatisch geschrieben */
export interface Call {
  id: string;
  customerNumber?: string;
  callerName?: string;
  callerNumber?: string;
  direction: 'inbound' | 'outbound';
  queueGroup?: string;
  startedAt: string;
  endedAt?: string;
  durationS?: number;
  agentId: string;
  /** Gesprächsergebnis (Migration 021) */
  disposition?: CallDisposition;
  /** Nur sinnvoll befüllt bei disposition === 'gekuendigt' */
  cancellationReason?: string;
  /** Kampagne, die zum Zeitpunkt des Anrufs lief (Migration 021) */
  campaignId?: string;

  // --- Echte Gesprächszeiten (Migration 028) --------------------------------
  // Erfasst über die Ende-Erkennung am Medien-Socket von myApps. Auf
  // Altbeständen und bei Anrufen aus timio fehlt das alles.

  /** Wann tatsächlich abgehoben wurde. `startedAt` ist dagegen das Klingeln. */
  connectedAt?: string;
  /**
   * DREIWERTIG, und das ist der Punkt: `true` abgehoben, `false` sicher nicht
   * abgehoben, `undefined` nicht gemessen. Der Nenner jeder
   * Erreichbarkeitsquote sind nur die Anrufe mit einem echten true/false —
   * sonst zöge jeder Rechner ohne Erkennung die Quote nach unten.
   */
  answered?: boolean;
  /** Woran das Ende erkannt wurde. Sagt, welchen Dauern man trauen darf. */
  endReason?: string;
  /** Wann das Gesprächsergebnis erfasst wurde — Grundlage der Nachbearbeitungszeit. */
  dispositionAt?: string;

  // --- Gesprächserfassung nach Leitfaden v2.0 (Migration 029) ---------------
  // Alles, was der Abschluss-Check der jeweiligen Kampagne verlangt. Siehe
  // src/lib/campaigns.ts für den Katalog, aus dem die Ids stammen.

  /** Kampagnenspezifisches Ergebnis, z.B. 'adresse-korrigiert' (PRL). */
  outcomeCode?: string;
  /** Winbackstatus. 'erfolgreich'/'nicht_erfolgreich' nur mit Ursache. */
  winbackStatus?: WinbackStatus;
  /** Ursache des Winback-Ergebnisses — Id aus dem Katalog der Kampagne. */
  winbackReason?: string;
  /** Eingesetzte Stufe des Winback-Baukastens. */
  winbackMeasure?: string;
  /** Aufgenommene Anschlusskennung. */
  homeId?: string;
  homeIdKind?: HomeIdKind;
  /** Wurde die Nummer wiederholt und vom Kunden bestätigt? */
  homeIdConfirmed?: boolean;
  doiStatus?: DoiStatus;
  /** Getrennt erfasste Kontaktarten der Einwilligung. */
  doiChannels?: DoiChannel[];
  doiSentAt?: string;
  doiConfirmedAt?: string;
  fraudSuspicion?: boolean;
  /** Ids der beobachteten Merkmale (wertfreie Beobachtung, keine Bewertung). */
  fraudMarkers?: string[];
  fraudNote?: string;
  /** Aufnehmender Mitarbeiter bzw. Vertriebspartner — Grundlage der Mustererkennung. */
  salesPartner?: string;
  /** Beratungsnote 1–6 (Welcome Call). */
  adviceScore?: number;
  /** Wurde beim Abschluss ein Beratungsprotokoll ausgehändigt? */
  adviceProtocol?: boolean;
  /** Kampagnenspezifische Felder (Gebäudedetails, Adressursache, …). */
  campaignData?: Record<string, unknown>;
  /** War der Abschluss-Check zum Erfassungszeitpunkt vollständig? */
  wrapupComplete?: boolean;
  wrapupAt?: string;
}

/**
 * Winbackstatus (Migration 029). Die beiden abrechenbaren Zustände verlangen
 * zwingend eine Ursache — ohne sie bleibt der Fall auf 'offen' stehen und ist
 * weder abrechenbar noch auswertbar (Vorgabe aus dem BVW-Leitfaden, in der
 * Datenbank als Check-Constraint hinterlegt).
 */
export type WinbackStatus = 'offen' | 'erfolgreich' | 'nicht_erfolgreich' | 'irrelevant';

/**
 * Art der aufgenommenen Anschlusskennung. Die Reihenfolge ist Vorgabe, nicht
 * Vorliebe: eine ausgewiesene HomeID hat immer Vorrang, danach die
 * ONT-Seriennummer, zuletzt die AD-Nummer der Dose.
 */
export type HomeIdKind = 'homeid' | 'ont' | 'ad' | 'genexis';

/**
 * Stand der Double-Opt-In Permission. Werblich angesprochen werden darf erst
 * bei 'bestaetigt' (§ 7 Abs. 2 UWG); der Nachweis ist fünf Jahre aufzubewahren
 * (§ 7a UWG).
 */
export type DoiStatus = 'offen' | 'angekuendigt' | 'versendet' | 'bestaetigt' | 'abgelehnt';

/** Kontaktarten werden laut Leitfaden getrennt erfasst. */
export type DoiChannel = 'email' | 'telefon' | 'mobil';

/**
 * Die erfassten Werte einer Gesprächsdokumentation — was die Oberfläche
 * sammelt, bevor daraus die Spalten oben werden. Schlüssel entsprechen den Ids
 * in WRAPUP_FIELDS (extension/src/campaigns.js), deshalb bewusst offen
 * gehalten: der Katalog kennt mehr Felder, als hier einzeln stehen können.
 */
export interface CallWrapup {
  outcomeCode?: string;
  legitimation?: string;
  winbackStatus?: WinbackStatus;
  winbackReason?: string;
  winbackMeasure?: string;
  rejectionReason?: string;
  homeId?: string;
  homeIdKind?: HomeIdKind;
  homeIdConfirmed?: boolean;
  doi?: DoiStatus;
  doiChannels?: DoiChannel[];
  fraudSuspicion?: boolean;
  fraudMarkers?: string[];
  fraudNote?: string;
  salesPartner?: string;
  adviceScore?: number;
  adviceProtocol?: boolean;
  note?: string;
  followUpAt?: string;
  /** Alles Weitere je Kampagne — Gebäudedetails, PRL-Ursache, Ausbaubedingung … */
  [field: string]: unknown;
}

// ============================================================================
// KAMPAGNEN & SCHICHTPLAN — Outbound-Umbau
// ============================================================================

/** Bestimmt in der Extension automatisch Skript & Einwandkarten (Migration 025). */
export type CampaignCallType = 'churn' | 'welcome' | 'prl' | 'dupe' | 'bvw' | 'courtesy' | 'other';

/** Fester, vom Chef gepflegter Kampagnen-Katalog (Migration 019). */
export interface Campaign {
  id: string;
  name: string;
  callType: CampaignCallType;
  active: boolean;
  createdBy?: string;
  createdAt: string;
}

/**
 * Schichtart eines Tages. 'frueh'/'spaet' sind Arbeit, alles andere nicht —
 * aber der Grund macht für die Planung den Unterschied (Migration 024):
 * 'frei' ist eingeplant, 'krank' ist Ausfall, 'urlaub' ist lange bekannt und
 * 'schulung' ist Anwesenheit ohne Telefonie. Welche Art wie zählt, steht
 * ausschließlich in SHIFT_META (src/lib/shifts.ts).
 */
export type ShiftType = 'frueh' | 'spaet' | 'frei' | 'urlaub' | 'krank' | 'schulung';

/** Ein Tag im geteilten Wochen-Schichtplan (Migration 020). */
export interface Shift {
  id: string;
  userId: string;
  shiftDate: string;
  shiftType: ShiftType;
  campaignId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Soll-Besetzung eines Wochentags (Migration 024). Je Wochentag statt je Datum,
 * weil der Bedarf dem Wochenrhythmus folgt — Ausnahmen an einzelnen Tagen
 * regelt der Chef über den Plan selbst.
 */
export interface StaffingTarget {
  /** ISO-Wochentag: 1 = Montag … 7 = Sonntag. */
  weekday: number;
  minFrueh: number;
  minSpaet: number;
}

/**
 * Stand einer Tauschanfrage (Migration 023). Der Weg ist immer derselbe:
 * pending → accepted → approved. Alles andere sind Abbrüche.
 *
 *   pending    A hat gefragt, B hat noch nicht geantwortet
 *   accepted   B ist einverstanden, der Chef muss noch bestätigen
 *   approved   bestätigt und im Plan vollzogen
 *   declined   B will nicht
 *   cancelled  A hat zurückgezogen
 *   rejected   der Chef hat abgelehnt
 */
export type SwapStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'approved' | 'rejected';

/** Ein Schichttausch zwischen zwei Agent:innen (Migration 023). */
export interface ShiftSwapRequest {
  id: string;
  /** Wer fragt — gibt seinen Tag ab. */
  requesterId: string;
  requesterDate: string;
  /** Wer gefragt wird — gibt seinen Tag ab. */
  partnerId: string;
  partnerDate: string;
  message?: string;
  status: SwapStatus;
  /** Schichtart beider Seiten beim Anlegen — nur Anzeige, siehe Migration 023. */
  requesterShiftType?: ShiftType;
  partnerShiftType?: ShiftType;
  decidedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  createdAt: string;
}

/**
 * Meldungsart im Postfach. Steuert Symbol und Farbe der Anzeige; eine
 * unbekannte Art landet bewusst nicht im Fehlerfall, sondern als neutrale
 * Meldung (siehe notificationLook() in src/lib/notifications.ts) — so kann die
 * Datenbank neue Arten liefern, ohne dass ein alter Client daran scheitert.
 */
export type NotificationKind =
  | 'shift-changed'
  | 'swap-requested'
  | 'swap-accepted'
  | 'swap-declined'
  | 'swap-cancelled'
  | 'swap-approved'
  | 'swap-rejected'
  | 'campaign'
  | 'incentive'
  | 'system';

/** Sprungziel einer Meldung — dieselbe Form wie eine Route im Router. */
export interface NotificationLink {
  route: string;
  kdnr?: string;
  agentKey?: string;
}

/** Eine Meldung im persönlichen Postfach (Migration 023). */
export interface AppNotification {
  id: string;
  /** Empfänger:in — nicht der Auslöser. */
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  link?: NotificationLink;
  actorId?: string;
  /** Name des Auslösers zum Zeitpunkt der Meldung (bleibt lesbar). */
  actorName?: string;
  /** Auslösender Datensatz, z. B. eine Tauschanfrage. */
  entityId?: string;
  readAt?: string;
  createdAt: string;
}

/** Wer einen Kunden besitzt und mit wem er geteilt wird */
export interface CustomerOwnership {
  /** User-Key des Besitzers */
  owner: string;
  /** User-Keys, mit denen der Kunde geteilt wird */
  sharedWith: string[];
}

export type AccessRequestStatus = 'pending' | 'approved' | 'rejected';

/** Anfrage auf Bearbeitungszugriff eines Kunden, den ein:e Kolleg:in besitzt */
export interface CustomerAccessRequest {
  id: string;
  customerNumber: string;
  /** User-Key (UUID) des/der Anfragenden */
  requesterId: string;
  /** User-Key (UUID) des/der Besitzer:in zum Zeitpunkt der Anfrage */
  ownerId?: string;
  /** Begründung der Anfrage */
  comment?: string;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt?: string;
  /** Wer hat entschieden (UUID) */
  decidedBy?: string;
}

/** Zielprämie (jede:r, der/die das Ziel erreicht) oder Wettbewerb (nur Platz 1) */
export type IncentiveMechanic = 'goal' | 'competition';
/** Was gemessen wird: Provision (€), Anzahl Verträge oder Abschlüsse gesamt */
export type IncentiveMetric = 'commission' | 'contracts' | 'deals';
export type IncentivePeriod = 'weekly' | 'monthly';

/** Zeitlich begrenztes Team-Ziel mit Belohnung, vom Chef konfiguriert */
export interface Incentive {
  id: string;
  title: string;
  mechanic: IncentiveMechanic;
  metric: IncentiveMetric;
  period: IncentivePeriod;
  /** Zielwert — nur bei mechanic === 'goal' relevant, sonst 0 */
  target: number;
  reward: string;
  active: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Stufen der Vertriebs-Pipeline für selbst angelegte Leads */
export type LeadStatus = 'neu' | 'inBearbeitung' | 'gewonnen' | 'verloren';

/** Dringlichkeit eines Leads */
export type LeadPriority = 'normal' | 'hoch' | 'dringend';

/** Selbst angelegter Vertriebs-Lead — geteiltes Team-Werkzeug */
export interface Lead {
  id: string;
  customerName: string;
  customerNumber?: string;
  phone?: string;
  /** Thema / Anliegen des Leads */
  topic?: string;
  status: LeadStatus;
  /** Dringlichkeit — steuert Sortierung und Hervorhebung */
  priority: LeadPriority;
  /** Wiedervorlage-Datum */
  followUpDate?: string;
  notes?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** Typ einer Lead-Aktivität */
export type LeadActivityType = 'contact' | 'note';

/** Eintrag im Aktivitäts-Log eines Leads (Kontaktversuch oder Team-Notiz) */
export interface LeadActivity {
  id: string;
  leadId: string;
  type: LeadActivityType;
  /** Notiztext — nur bei type === 'note', sonst undefined */
  content?: string;
  createdBy?: string;
  createdAt: string;
}

// ============================================================================
// STATUS BOARD — Team-Presence & Zeitverteilung
// ============================================================================

/** Der aktuelle Status einer Person (eine Zeile je Nutzer:in). */
export interface UserStatus {
  /** User-Key (UUID) */
  userId: string;
  /** Status-ID (siehe STATUS_DEFS), null = kein Status gesetzt */
  status: string | null;
  /** Ticketschicht-Untertyp (Leads, TL, …) */
  sub?: string;
  /** Freitext bei Status mit Beschreibung (Sonderaufgabe, Klärung, …) */
  description?: string;
  /** Kurz abwesend — Status bleibt gesetzt, wird aber gedimmt angezeigt */
  isAfk: boolean;
  /** Beginn des aktuellen Status (ISO) */
  startedAt?: string;
  updatedAt: string;
}

/** Ein abgeschlossener Status-Abschnitt in der Historie. */
export interface StatusLogEntry {
  id: string;
  /** User-Key (UUID) — kann null sein, falls Nutzer:in gelöscht wurde */
  userId?: string;
  status: string;
  sub?: string;
  description?: string;
  isAfk: boolean;
  startedAt: string;
  endedAt: string;
  /** Dauer des Abschnitts in Sekunden */
  durationSeconds: number;
  createdAt: string;
}

// ============================================================================
// AUDIT LOG — DSGVO-Nachvollziehbarkeit (Art. 30)
// ============================================================================

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'purge'
  | 'login'
  | 'logout'
  | 'role_change'
  | 'lock'
  | 'unlock'
  | 'consent'
  | 'export';

export type AuditEntity =
  | 'contract'
  | 'tariff_change'
  | 'note'
  | 'lead'
  | 'lead_activity'
  | 'customer'
  | 'user'
  | 'incentive'
  | 'auth'
  | 'settings'
  | 'status';

/** Unveränderlicher Audit-Eintrag — wer hat wann was getan? */
export interface AuditLogEntry {
  id: string;
  /** UUID des handelnden Nutzers — kann null sein, falls Nutzer gelöscht wurde */
  actorId?: string;
  /** Anzeige-Name zum Zeitpunkt der Aktion (denormalisiert, überlebt User-Löschung) */
  actorName: string;
  action: AuditAction;
  entityType: AuditEntity;
  /** ID der betroffenen Entität (kann KdNr, UUID, Username sein) */
  entityId?: string;
  /** Menschenlesbares Label, z. B. Kundenname */
  entityLabel?: string;
  /** Optionale strukturierte Details (vorher/nachher, Kontextfelder) */
  details?: Record<string, unknown>;
  createdAt: string;
}
