(function initChurnScraper() {
  "use strict";

  // Content-Script auf gfiz-dash.tng.de: schlägt zu einer Kundennummer den
  // Kündiger-/Churn-Status nach. Wird NICHT automatisch aktiv – es wartet auf
  // eine sc-lookup-churn-Nachricht des Hintergrund-Workers (lookup.js), der
  // seinerseits nur bei aktivem Schalter + Bestätigung überhaupt anfragt.
  //
  // Die DOM-Automatisierung nutzt die gemeinsamen Helfer aus shared.js
  // (reactSetValue, waitForCondition, waitForStableRows), die eigentliche
  // Normalisierung übernimmt der reine, getestete Parser shared.parseChurn.

  const app = globalThis.StadtnetzCRM || {};
  const shared = app.shared || {};

  function sendStep(requestId, step, state) {
    try {
      chrome.runtime.sendMessage(
        { type: "sc-lookup-step", requestId, kind: "churn", step, state },
        () => void chrome.runtime.lastError
      );
    } catch (error) { /* Worker beendet – Ergebnis wird trotzdem zurückgegeben */ }
  }

  // Nur echte Datenzeilen (Ant-Design-Tabelle) – Kopf-/Leerzeilen haben ≤5 Zellen.
  function getDataRows() {
    return Array.from(document.querySelectorAll(".ant-table-tbody tr"))
      .filter((row) => row.querySelectorAll("td").length > 5);
  }

  // Feste Spalten-Indizes stammen aus dem Live-DOM des gfiz-Dashboards. Die
  // Sonderzellen (Button, Ant-Select, Anchor) werden gezielt ausgelesen, sonst
  // der reine Zelltext. Die Normalisierung/Filterung liegt in shared.parseChurn.
  function readRow(row) {
    const tds = Array.from(row.querySelectorAll("td"));
    const t = (i) => (tds[i] && tds[i].textContent ? tds[i].textContent.trim() : "");
    const cellChild = (i, selector) => {
      const child = tds[i] && tds[i].querySelector(selector);
      return child && child.textContent ? child.textContent.trim() : "";
    };
    const jiraAnchor = tds[22] && tds[22].querySelector("a");
    return {
      vertrag: cellChild(1, "button") || t(1),
      geschaeftsfall: cellChild(3, ".ant-select-selection-item") || t(3),
      ursache: t(4),
      eingang: t(5),
      jiraTicket: (jiraAnchor && jiraAnchor.textContent && jiraAnchor.textContent.trim()) || "",
      jiraHref: (jiraAnchor && jiraAnchor.href) || "",
      kommentar: cellChild(28, ".w-64") || t(28)
    };
  }

  async function runChurnLookup(requestId, kundennummer) {
    if (!kundennummer) throw new Error("Keine Kundennummer angegeben.");

    sendStep(requestId, "search", "active");
    const input = await shared.waitForCondition(
      () => document.querySelector("input.ant-input"), 6000
    );
    if (!input) throw new Error("Suchfeld nicht gefunden – Seite noch nicht geladen?");
    shared.reactSetValue(input, "");
    await shared.sleep(150);
    shared.reactSetValue(input, kundennummer);
    sendStep(requestId, "search", "done");

    sendStep(requestId, "settle", "active");
    await shared.sleep(700);
    await shared.waitForStableRows(() => getDataRows().length, {
      quietMs: 500, timeoutMs: 3000, intervalMs: 250
    });
    sendStep(requestId, "settle", "done");

    sendStep(requestId, "extract", "active");
    const rows = getDataRows().map(readRow);
    // Suchfeld wieder leeren, damit kein Kundenbezug im Dashboard stehen bleibt.
    shared.reactSetValue(input, "");
    const result = shared.parseChurn({ found: rows.length > 0, kundennummer, rows });
    sendStep(requestId, "extract", "done");
    return result;
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return false;
      // Erreichbarkeits-Ping – siehe baustatus-content.js. Ein verwaistes
      // Content-Script antwortet nicht; der Worker lädt den Tab dann neu.
      if (message.type === "sc-ping") { sendResponse({ ok: true, pong: true, kind: "churn" }); return false; }
      if (message.type !== "sc-lookup-churn") return false;
      runChurnLookup(message.requestId, String(message.customerNumber || "").trim())
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: (error && error.message) || String(error) }));
      return true; // asynchrone Antwort
    });
  } catch (error) {
    // Chrome-Kontext nicht verfügbar (Extension neu geladen) – Script endet still.
  }
})();
