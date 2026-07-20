(function initRules() {
  "use strict";

  const app = window.SupportCopilot;
  const UNKNOWN = app.jiraReader.UNKNOWN;

  function isKnown(value) {
    return Boolean(value && value !== UNKNOWN);
  }

  function normalise(value) {
    return (value || "").toLocaleLowerCase("de-DE");
  }

  function ticketWarnings(ticket) {
    const warnings = [];
    const customerKnown = isKnown(ticket.customerName) || isKnown(ticket.customerReference);

    if (!customerKnown) {
      warnings.push("Kundenname oder Kundennummer sind im sichtbaren Ticketbereich nicht erkennbar.");
    }
    if (!isKnown(ticket.description)) {
      warnings.push("Ein Anliegen bzw. eine Beschreibung ist nicht sichtbar.");
    }
    if (ticket.commentCount === 0) {
      warnings.push("Es ist noch kein sichtbarer Kommentar vorhanden.");
    }
    return [...warnings, ...typeSpecificWarnings(ticket)];
  }

  // Zusätzliche, tickettyp-spezifische Vollständigkeits-Checks. Rein
  // regelbasiert (kein KI-Aufruf), damit sie immer verfügbar bleiben. Neue
  // Typen/Regeln lassen sich einfach als weitere Einträge ergänzen.
  const TYPE_RULES = [
    {
      id: "reklamation",
      matchesType: /reklamation/,
      checks: [
        (ticket, combinedText) => (/frist|deadline|bis\s+\d|termin/.test(combinedText)
          ? null
          : "Reklamation ohne erkennbare Frist: Prüfe, ob eine Rückmeldefrist dokumentiert werden muss."),
        (ticket) => (isKnown(ticket.customerReference) || isKnown(ticket.customerName)
          ? null
          : "Reklamation ohne Kundenreferenz: Kundennummer oder -name ergänzen, bevor die Reklamation bearbeitet wird.")
      ]
    },
    {
      id: "stoerung",
      matchesType: /störung|incident/,
      checks: [
        (ticket, combinedText) => (/seit\s+\d|beginn|aufgetreten|fehlermeldung/.test(combinedText)
          ? null
          : "Störung ohne erkennbaren Zeitpunkt: Wann trat das Problem zuerst auf?")
      ]
    }
  ];

  function typeSpecificWarnings(ticket) {
    const type = normalise(ticket.issueType);
    const combinedText = normalise(`${ticket.description} ${(ticket.comments || []).join(" ")}`);
    const warnings = [];
    for (const rule of TYPE_RULES) {
      if (!rule.matchesType.test(type)) continue;
      for (const check of rule.checks) {
        const message = check(ticket, combinedText);
        if (message) warnings.push(message);
      }
    }
    return warnings;
  }

  function nextStep(ticket) {
    const status = normalise(ticket.status);
    const combined = normalise(`${ticket.description} ${ticket.latestInformation}`);
    const warnings = ticketWarnings(ticket);

    if (/nicht erreicht|kein kontakt/.test(combined)) {
      return {
        title: "Rückruf verbindlich dokumentieren",
        text: "Notiere den nächsten Kontaktversuch mit Datum, Uhrzeit und Kanal. So bleibt der Rückruf für das Team nachvollziehbar.",
        action: "Rückruf-Kommentar übernehmen",
        intentId: "callback"
      };
    }

    if (/wart|pending|rückmeldung ausstehend/.test(status)) {
      return {
        title: "Wartegrund festhalten",
        text: "Dokumentiere, worauf gewartet wird, wer zuständig ist und wann du erneut nachfasst.",
        action: "Warte-Kommentar übernehmen",
        intentId: "handoff"
      };
    }

    if (warnings.some((warning) => /Kundenname|Anliegen/.test(warning))) {
      return {
        title: "Kundenkontext vervollständigen",
        text: "Prüfe Kundennummer, Kundenname und Anliegen. Fehlende Informationen sollten vor der weiteren Bearbeitung angefordert werden.",
        action: "Daten-anfordern-Kommentar übernehmen",
        intentId: "data-needed"
      };
    }

    if (/offen|open|neu|new/.test(status) && ticket.commentCount === 0) {
      return {
        title: "Erstkontakt strukturieren",
        text: "Kundenkontext prüfen und einen Erstkommentar mit Anliegen, Ergebnis und nächstem Schritt erfassen.",
        action: "Prüf-Kommentar übernehmen",
        intentId: "checked"
      };
    }

    if (/bearbeitung|fortschritt|progress|in arbeit/.test(status)) {
      return {
        title: "Follow-up festhalten",
        text: "Halte fest, wer was bis wann erledigt und wann der Kunde das nächste Update erhält.",
        action: "Bearbeitungs-Kommentar übernehmen",
        intentId: "in-progress"
      };
    }

    return {
      title: "Nächste Aktion konkretisieren",
      text: "Ergänze im Kommentar Ergebnis, Zusage und einen klaren nächsten Schritt mit Verantwortung oder Termin.",
      action: "Kommentarbausteine öffnen",
      intentId: ""
    };
  }

  function commentQuality(text) {
    const value = (text || "").trim();
    const normal = normalise(value);
    const checks = [];

    if (!value) {
      return [{ level: "blocker", text: "Bitte formuliere zuerst einen Kommentar." }];
    }

    const hasSummary = value.length >= 60 || /anliegen|besprochen|gesprochen|sachverhalt|kontext/.test(normal);
    const hasOutcome = /ergebnis|gelöst|geklärt|informiert|bestätigt|rückmeldung|erreicht|nicht erreicht|prüfung/.test(normal);
    const hasNextStep = /nächste(?:r|n)? schritt|rückruf|nachfass|weitergegeben|meld(?:e|ung)|bis\s+\d|vereinbart|follow-?up|warte/.test(normal);
    const needsCallbackTime = /rückruf|nicht erreicht|kein kontakt/.test(normal);
    const hasCallbackTime = /\b\d{1,2}[.:]\d{2}\b|\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b|heute|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag/.test(normal);

    checks.push({
      level: hasSummary ? "ok" : "warning",
      text: hasSummary ? "Kurze Zusammenfassung erkannt." : "Kurze Zusammenfassung fehlt noch: Worum ging es?"
    });
    checks.push({
      level: hasOutcome ? "ok" : "warning",
      text: hasOutcome ? "Kundenergebnis erkannt." : "Kundenergebnis ergänzen: Was ist herausgekommen?"
    });
    checks.push({
      level: hasNextStep ? "ok" : "warning",
      text: hasNextStep ? "Nächster Schritt erkannt." : "Nächsten Schritt ergänzen: Wer macht was bis wann?"
    });

    if (needsCallbackTime) {
      checks.push({
        level: hasCallbackTime ? "ok" : "warning",
        text: hasCallbackTime ? "Rückrufzeit erkannt." : "Rückruf erwähnt: Datum oder Uhrzeit ergänzen."
      });
    }

    return checks;
  }

  function canCopyAfterCheck(checks) {
    return !checks.some((check) => check.level === "blocker");
  }

  app.rules = { ticketWarnings, nextStep, commentQuality, canCopyAfterCheck };
})();
