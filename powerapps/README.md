# TNG CRM → Microsoft Power Platform (Power Apps Canvas + Dataverse)

Dieser Ordner ist das **Bau-Kit**, um das bestehende React/Supabase-CRM als
**Power Apps Canvas-App auf Dataverse** in eurem eigenen Microsoft-365-Tenant
nachzubauen. Damit liegen alle personenbezogenen Daten in eurer bereits
datenschutzrechtlich freigegebenen Microsoft-Umgebung (EU Data Boundary,
bestehender AVV mit Microsoft) — das war der ganze Auslöser.

> **Ehrliche Einordnung:** Eine Power App wird im **maker.powerapps.com**-Studio
> bzw. als Dataverse-Solution in einem **Tenant** gebaut. Dieses Repo kann den
> Tenant nicht ersetzen — es liefert die **vollständige, importierbare Vorlage**
> (Datenmodell, Sicherheits­rollen, Design, Power-Fx-Logik, Screens, Seed-Daten)
> plus eine Schritt-für-Schritt-Importanleitung. Der einzige Schritt, der in
> eurem Tenant passieren muss, ist das Importieren/Zusammenklicken nach
> Anleitung 06. Alles davor ist hier fertig.

## Architektur-Entscheidung

| Frage | Entscheidung | Begründung |
|-------|--------------|------------|
| App-Typ | **Canvas-App** | Erhält das maßgeschneiderte UI (Apple-/Trust-Stil) am besten; Model-driven würde das Design wegwerfen. |
| Datenbank | **Dataverse** | Liegt im Tenant, hat Audit, rollenbasierte Sicherheit, Beziehungen — ersetzt Postgres **und** RLS nativ. |
| Anmeldung | **Entra ID (Azure AD)** | Ersetzt den PIN-Login. Sicherer, SSO, keine eigene Auth-Logik mehr. |
| Realtime | **Refresh()** statt Live-Push | Power Apps kann kein echtes Live-Sync (siehe 07, bewusste Abweichung). |
| Export | **native Connectoren** | CSV-/Excel-/SharePoint-Export ist in der Power Platform Standard. |

## Datei-Index (in Bau-Reihenfolge)

| Datei | Inhalt |
|-------|--------|
| `01-dataverse-schema.md` | Alle Tabellen, Spalten, Datentypen, Choices, Beziehungen, Keys |
| `02-security-model.md` | Sicherheitsrollen, Ownership, Sharing — ersetzt die RLS-Policies 1:1 |
| `03-design-system.md` | Design-System (aus dem `ui-ux-pro-max`-Skill) + Power-Fx-Theme (Hell/Dunkel) |
| `04-powerfx-logic.md` | Gesamte Geschäftslogik (Provision, Stats, Incentives, Validierung) in Power Fx |
| `05-canvas-screens.md` | Screen-für-Screen-Bauanleitung mit konkreten Power-Fx-Formeln je Control |
| `06-import-and-build.md` | Schritt-für-Schritt: Environment, Solution, Tabellen, App, Rollen, Seed, Publish (inkl. `pac`-Befehle) |
| `07-roadmap-gaps-compliance.md` | Restliche Screens, Feature-Lücken, Lizenzen, Datenmigration, Betriebsrat |
| `seed/products.csv` | Produkt- + Provisions-Stammdaten (importierbar) |
| `seed/tariff-commission.csv` | Tarifwechsel-Provisionsmatrix |
| `src/*.pa.yaml` | Power-Apps-YAML-Quelle der Kern-Screens (mit `pac canvas pack` paketierbar) |

## Konzept-Mapping Supabase → Power Platform

| Supabase / React | Power Platform |
|------------------|----------------|
| Postgres-Tabelle | Dataverse-Tabelle |
| `jsonb products[]` | Kind-Tabelle `tng_contractproduct` (1:N) |
| Row Level Security (RLS) | Dataverse-Sicherheitsrollen + Ownership + Sharing |
| `auth_is_manager()` | Sicherheitsrolle **TNG Chef** |
| `is_active` Flag | Aktivierter/deaktivierter Entra-Benutzer |
| PIN-Login + Throttle | Entra-Anmeldung + Conditional Access |
| Supabase Realtime | `Refresh()` auf Timer/Screen-Fokus |
| `audit_log` Tabelle | Dataverse-Auditing (nativ) + optional `tng_auditevent` |
| Provision (TS in `utils.ts`) | Power-Fx-Formeln (Datei 04) + ggf. Rollup-Spalten |
| CSV-Export (`utils.ts`) | `Export`/Office Scripts / Excel-Connector |
| SharePoint-Export (MSAL/Graph) | SharePoint-/Excel-Connector (nativ) |

## Scope dieses Kits

**Vollständig enthalten:** komplettes Datenmodell (12 Tabellen), Sicherheits­modell,
Design-System, **die gesamte Geschäftslogik** in Power Fx, Seed-Daten und eine
detaillierte Bauanleitung für die **Kern-Screens** (Dashboard, Verträge inkl.
Formular, Leads).

**Als Roadmap (Datei 07), gleiche Muster anwendbar:** Tarifwechsel, Notizen,
Kundenliste/-detail, Audit-Log, Team-Dashboard, Mitarbeiter-Detail, Monats-/
Team-Berichte, Incentive-Manager, Leaderboard, Einstellungen.

Damit ist „der Recode" als Bauplan zu ~100 % spezifiziert und in den
wichtigsten Teilen bis auf Control-Ebene ausformuliert — der Rest ist
mechanische Wiederholung derselben Muster.
