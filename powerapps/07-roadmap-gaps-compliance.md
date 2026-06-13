# 07 — Roadmap, Feature-Lücken, Lizenzen & Compliance

## Restliche Screens (gleiche Muster wie `05`)
Mit den Bausteinen aus `04` (Logik) und `05` (Galerie/Form/Badge/KPI-Card) sind
diese mechanisch nachzubauen:

| Screen (React) | Power-Apps-Umsetzung | Logik-Quelle |
|----------------|----------------------|--------------|
| `TariffChanges.tsx` | Galerie + Form auf `tng_tariffchange`, Provision aus `tng_tariffrate` | 04 B |
| `Notes.tsx` | Galerie + Form auf `tng_note`, optional Kunden-Lookup | — |
| `Customers.tsx` / `CustomerDetail.tsx` | Galerie über `tng_customer` mit Zählern/Provision; Detail mit verknüpften Listen | 04 H |
| `AuditLog.tsx` | Galerie über Dataverse-Audit / `tng_auditevent` (nur Chef-Rolle) | 02 |
| `TeamDashboard.tsx` | KPI-Cards über alle Nutzer | 04 D |
| `AgentDetail.tsx` | `agentStats` je Nutzer | 04 C |
| `MonthlyReport.tsx` / `TeamReport.tsx` | Galerie + CSV/Excel-Export | 04 C/D |
| `Incentives.tsx` / `IncentiveManager.tsx` / `Leaderboard.tsx` | Standings-Galerie | 04 E |
| `Settings.tsx` | Form auf `tng_userprofile` + Stammdaten (`tng_product`/`tng_tariffrate`) | — |
| `FollowUpInbox` / `ExpiryRadar` | gefilterte Galerien | 04 F |

## Bewusste Feature-Unterschiede (kein 1:1 möglich)

| React/Supabase | Power Apps | Bewertung |
|----------------|-----------|-----------|
| **Realtime-Live-Sync** (alle sehen Änderungen sofort) | `Refresh(tng_*)` auf Timer (z. B. 60 s) oder bei `Screen.OnVisible` | **Verschlechterung** — kein echtes Push |
| **Installierbare PWA / Offline** | Power Apps Mobile-App; Offline nur eingeschränkt (Canvas Offline) | Verschlechterung |
| **Command-Palette** (`Cmd+K`) | Globale Suchleiste je Screen | vereinfacht |
| **Theme-Umschalter Hell/Dunkel/System** | `varDark`-Toggle (03); „System" via `Param()`/Profil | gleichwertig |
| **PIN-Login + Sperre** | Entra-SSO + Conditional Access + Smart Lockout | **Verbesserung** (sicherer) |
| **CSV-Export** (`utils.ts`) | `Export`-Control / Office Scripts / Excel-Connector | gleichwertig+ |
| **SharePoint-Export** (MSAL/Graph) | SharePoint-/Excel-Connector nativ | **Verbesserung** (kein Custom-Auth) |
| **Audit-Log** (custom Tabelle) | Dataverse-Auditing nativ + `tng_auditevent` | **Verbesserung** |

## Lizenzen (wichtig — laufende Kosten)
- **Dataverse + Premium-Connectoren** brauchen **Power Apps Premium** (per user
  oder per app). Das ist **nicht** in den Standard-M365-Plänen enthalten.
- Jede:r aktive Nutzer:in braucht eine Lizenz **plus** ein Entra-Konto.
- Dataverse-**Kapazität** (DB/Datei/Log) im Blick behalten.
- Vor Rollout: Lizenzbedarf × Teamgröße durchrechnen — das ist der reale
  Dauer-Kostenpunkt gegenüber dem (quasi kostenlosen) Supabase-Hobby-Tier.

## Compliance — was bleibt (trotz Microsoft)
Die Migration löst die **Anbieter-/Datenresidenz-Frage** (Daten im freigegebenen
EU-Microsoft-Tenant). **Nicht** automatisch erledigt:
- **DSGVO-Pflichten bleiben:** Einwilligung (Art. 13 → `tng_consentgivenon`),
  Auskunft, Löschung (Art. 17 → Kaskaden-Löschung), Verarbeitungsverzeichnis
  (Art. 30 → Dataverse-Audit). Alles im Modell vorgesehen.
- **Mitbestimmung Betriebsrat:** Das **Leaderboard / die Team-Auswertung ist
  Mitarbeiter-Monitoring** und damit nach **§87 BetrVG mitbestimmungspflichtig** —
  völlig unabhängig von der Plattform. Vor produktivem Einsatz mit dem Betriebsrat
  klären (ggf. Leaderboard-Opt-in beibehalten, das es schon gibt:
  `tng_leaderboardoptin`).
- **AVV/Datenresidenz** final mit eurem/eurer Datenschutzbeauftragten bestätigen
  (EU Data Boundary, Standardvertragsklauseln im Microsoft-DPA).

## Empfohlene Bau-Reihenfolge
1. Datenmodell + Sicherheit (01/02) → 2. Seed (Schritt 4) → 3. Theme + Logik
(03/04) → 4. Kern-Screens (05) → 5. Pilot mit Chef + 2 Agent:innen →
6. restliche Screens (oben) → 7. Datenmigration → 8. Betriebsrat/DSB-Freigabe →
9. Rollout.
