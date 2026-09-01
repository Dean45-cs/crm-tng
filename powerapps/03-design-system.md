# 03 — Design-System (Power Apps Canvas)

Generiert mit dem **`ui-ux-pro-max`-Skill** für „crm b2b sales dashboard
enterprise saas" und auf Power Apps übertragen.

```
Style:      Trust & Authority  (seriös, vertrauenswürdig, datendicht, WCAG-AA/AAA)
Pattern:    Enterprise — klare Hierarchie, Kennzahlen prominent, ruhige Akzente
Anti-Pattern (vermeiden): verspieltes Design · KI-Lila/Pink-Verläufe · Emoji als Icons
```

## Farb-Tokens

| Token | Hell | Dunkel | Einsatz |
|-------|------|--------|---------|
| Primary | `#0F172A` | `#E2E8F0` | Kopfzeilen, Sidebar, Haupttext-Akzent |
| Secondary | `#334155` | `#94A3B8` | Sekundärtext, Rahmen-Akzent |
| Accent / CTA | `#0369A1` | `#38BDF8` | Buttons, aktive Navigation, Links |
| Background | `#F8FAFC` | `#0B1220` | App-Hintergrund |
| Surface (Karten) | `#FFFFFF` | `#111A2E` | Karten, Galerie-Zeilen, Modals |
| Text | `#020617` | `#F1F5F9` | Fließtext |
| Text muted | `#475569` | `#94A3B8` | Labels, Hilfetext (min. 4.5:1) |
| Border | `#E2E8F0` | `#1E293B` | Trennlinien, Karten-Rand |
| Success | `#15803D` | `#4ADE80` | Status „Aktiv", positive KPIs |
| Warning | `#B45309` | `#FBBF24` | Wiedervorlage „bald", Auslauf 31–60 T |
| Danger | `#B91C1C` | `#F87171` | Storno, überfällig, Auslauf ≤30 T |

Status-/Ampel-Zuordnung (deckungsgleich mit `utils.ts`):
`offen → muted` · `aktiv → success` · `storniert → danger` ·
Auslauf `soon(≤30) → danger` · `medium(31–60) → warning` · `later(61–90) → #CA8A04`.

## Typografie
Empfehlung des Skills: **Plus Jakarta Sans**.

> **Power-Apps-Hinweis:** Canvas-Apps haben eine feste Schriftliste. Plus Jakarta
> Sans ist **nicht** dabei. Zwei Wege: (a) **`Open Sans`** als nächste eingebaute
> Schrift nehmen (empfohlen, null Aufwand), oder (b) Plus Jakarta Sans per
> **benutzerdefinierter Schrift** (Custom font über ein PCF-/HTML-Text-Control)
> laden. Default unten: `Font.'Open Sans'`.

| Stufe | Größe | Gewicht |
|-------|-------|---------|
| Display / Seitentitel | 28 | Semibold |
| Sektionstitel | 20 | Semibold |
| Karten-/KPI-Wert | 24 | Bold |
| Body | 15 | Regular |
| Label / Caption | 12–13 | Medium |

## Abstände, Radius, Elevation
- Spacing-Skala (px): **4 · 8 · 12 · 16 · 24 · 32** (8er-Rhythmus).
- Eckenradius: Karten/Modals **12**, Buttons/Inputs **8**, Badges **999**.
- Elevation: Karten leichter Schatten (in Canvas via `DropShadow.Light` an
  Containern), Modals stärker. Hover/Pressed: Farb-/Opacity-Wechsel, **kein**
  Layout-verschiebendes Skalieren.

## Power-Fx-Theme (App → `Formulas`)
In **App.Formulas** als benannte Formeln einfügen. `varDark` wird in `App.OnStart`
gesetzt (System-Theme bzw. Toggle, ersetzt `theme.ts`). Alles referenziert dann
`Theme.Accent` usw. — ein Schalter färbt die ganze App um.

```powerfx
// App.OnStart
Set(varDark, false);   // optional: aus tng_userprofile/Param() lesen
Set(varUser, LookUp('Users', 'Primary Email' = User().Email));

// App.Formulas  (benannte Formeln = automatisch reaktiv)
Theme = If(
    varDark,
    {
        Primary:    ColorValue("#E2E8F0"),
        Secondary:  ColorValue("#94A3B8"),
        Accent:     ColorValue("#38BDF8"),
        Background: ColorValue("#0B1220"),
        Surface:    ColorValue("#111A2E"),
        Text:       ColorValue("#F1F5F9"),
        TextMuted:  ColorValue("#94A3B8"),
        Border:     ColorValue("#1E293B"),
        Success:    ColorValue("#4ADE80"),
        Warning:    ColorValue("#FBBF24"),
        Danger:     ColorValue("#F87171")
    },
    {
        Primary:    ColorValue("#0F172A"),
        Secondary:  ColorValue("#334155"),
        Accent:     ColorValue("#0369A1"),
        Background: ColorValue("#F8FAFC"),
        Surface:    ColorValue("#FFFFFF"),
        Text:       ColorValue("#020617"),
        TextMuted:  ColorValue("#475569"),
        Border:     ColorValue("#E2E8F0"),
        Success:    ColorValue("#15803D"),
        Warning:    ColorValue("#B45309"),
        Danger:     ColorValue("#B91C1C")
    }
);

// Abstände & Radius als Tokens
Space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
Radius = { card: 12, control: 8, pill: 999 };
FontMain = Font.'Open Sans';

// Status-Farbe (Vertrag) — zentral, in Galerien/Badges nutzen
StatusColor(status: Text): Color =
    Switch(status,
        "Aktiv",     Theme.Success,
        "Storniert", Theme.Danger,
        Theme.TextMuted);
```

## Accessibility-Checkliste (auf jeden Screen anwenden)
- [ ] Textkontrast ≥ 4,5:1 (Hell **und** Dunkel) — Tokens oben erfüllen das.
- [ ] `TabIndex` für sinnvolle Tastatur-Reihenfolge; `AccessibleLabel` an Icons/Buttons.
- [ ] Status nie nur über Farbe — immer + Text-Label (Badge zeigt Wort).
- [ ] Touch-Ziele ≥ 44 px Höhe bei Buttons/Galerie-Zeilen.
- [ ] Fokus sichtbar (`FocusedBorderColor = Theme.Accent`, `FocusedBorderThickness = 2`).
- [ ] Keine Emoji als Icons — Power-Apps-Icons (`Icon.*`) verwenden.
