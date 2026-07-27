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
  //
  // Die Spalten werden über die Tabellenköpfe zugeordnet, nicht über feste
  // Zellindizes. Feste Indizes (früher 1/3/4/5/22/28) verschieben sich, sobald
  // das Dashboard eine Spalte ergänzt oder eine Auswahlspalte einblendet – dann
  // stand plötzlich Unsinn in den Feldern oder alles war leer, ohne dass ein
  // Fehler sichtbar wurde. Die alten Indizes bleiben als Rückfallebene.

  const app = globalThis.StadtnetzCRM || {};
  const shared = app.shared || {};
  const DASH = ((app.CONFIG || {}).lookups || {}).churn || {};

  function log(...args) {
    try { console.log("[Netz-Auskunft/Churn]", ...args); } catch (error) { /* egal */ }
  }

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

  // Ant-Design zeigt bei leerem Ergebnis einen eigenen Platzhalter. Ihn zu
  // erkennen ist wichtig: „keine Treffer" ist ein gültiges Ergebnis und darf
  // nicht bis zum Timeout auf Zeilen warten.
  function hasEmptyState() {
    return Boolean(
      document.querySelector(".ant-table-placeholder, .ant-empty, .ant-table-tbody .ant-table-expanded-row-placeholder")
    );
  }

  // Das Suchfeld der Churnliste.
  //
  // Reihenfolge mit Bedacht: das ERSTE sichtbare `input.ant-input` ist auf der
  // Churnliste nachweislich das Suchfeld (so lief die Abfrage schon immer, wenn
  // der Reiter offen war). Diese bewährte Wahl bleibt der Normalfall; ein
  // Feld mit passendem Platzhalter geht nur dann vor, wenn es eines gibt.
  // Erst wenn gar kein ant-input sichtbar ist, wird breiter gesucht – sonst
  // könnte ein Filterfeld aus einem Spaltenmenü das Rennen machen.
  function visibleInputs(selector) {
    return Array.from(document.querySelectorAll(selector))
      .filter((input) => (shared.isVisible ? shared.isVisible(input) : true));
  }

  function findSearchInput() {
    const hint = /kunde|vertrag|such|client|nummer|id/i;
    const labelOf = (input) =>
      `${input.getAttribute("placeholder") || ""} ${input.getAttribute("aria-label") || ""} ${input.getAttribute("name") || ""}`;

    const antInputs = visibleInputs("input.ant-input");
    if (antInputs.length) {
      return antInputs.find((input) => hint.test(labelOf(input))) || antInputs[0];
    }
    const others = visibleInputs("input[type='text'], input[type='search']");
    if (others.length) {
      return others.find((input) => hint.test(labelOf(input))) || others[0];
    }
    return document.querySelector("input.ant-input") || null;
  }

  // ── Spaltenzuordnung über die Tabellenköpfe ────────────────────────────────

  // Je Spalte mehrere Muster in ABSTEIGENDER Genauigkeit. Sie werden der Reihe
  // nach über alle Kopfzellen probiert, damit ein weites Muster keine Spalte
  // klaut: "Zeitstempel Änderung" darf nicht als Kündigungsdatum durchgehen,
  // bloß weil es weiter links steht. `fallback` ist der Zellindex aus dem
  // Live-DOM – die Notbremse, wenn ein Kopf gar nicht erkannt wird.
  //
  // Die Muster sind an der echten Churnliste ausgerichtet (Spalten: Vertrag,
  // Kundennummer, Zeitstempel Änderung, Winback Status, Ursache Real,
  // JIRA Ticket-Nr., Rückruf Bitte, Dealcloser …). Winback-Status, Ursache und
  // Dealcloser sind für das Rückgewinnungsgespräch das Wesentliche: sie sagen,
  // woran es lag und was dem Kunden schon angeboten wurde.
  const COLUMNS = shared.CHURN_COLUMNS || [];

  // Der Ant-Design-Container um Kopf UND Körper.
  //
  // Das ist der springende Punkt: sobald die Tabelle breiter ist als das Fenster
  // – und die Churnliste ist es –, rendert Ant den Kopf in eine EIGENE Tabelle
  // (.ant-table-header > table) und den Körper in eine zweite
  // (.ant-table-body > table). Wer den Kopf in der Tabelle des Körpers sucht,
  // findet nichts, ordnet keine einzige Spalte zu und liest anschließend die
  // falschen Zellen aus: der Winback-Status stand im Feld „Grund", die
  // Ticketnummer nirgends.
  function churnRoot() {
    // Am Anker der Zeile festmachen, die auch wirklich gelesen wird: bei
    // festgepinnten Spalten kann es mehrere tbody-Elemente geben, und der
    // erstbeste wäre womöglich der schmale Klon ohne die meisten Spalten.
    const row = getDataRows()[0];
    const fromRow = row && (row.closest(".ant-table") || row.closest(".ant-table-container"));
    if (fromRow) return fromRow;
    const body = document.querySelector(".ant-table-tbody");
    if (!body) return null;
    return body.closest(".ant-table") || body.closest(".ant-table-container") || body.closest("table") || null;
  }

  // Kopftexte je Spaltenindex. Berücksichtigt colspan/rowspan (mehrzeilige
  // Köpfe); Lücken (z. B. die Auswahlspalte ohne Beschriftung) bleiben leer.
  function readHeaders(rootEl) {
    const headers = [];
    if (!rootEl) return headers;
    // Nur der erste Kopf: gibt es mehrere (festgepinnte Spalten), enthält der
    // erste die vollständige Kopfzeile – ein zweiter würde die Indizes vermischen.
    const head = rootEl.querySelector("thead");
    if (!head) return headers;
    const occupied = {};
    Array.from(head.querySelectorAll("tr")).forEach((row) => {
      let col = 0;
      Array.from(row.querySelectorAll("th")).forEach((th) => {
        while (occupied[col] > 0) { occupied[col] -= 1; col += 1; }
        const colspan = parseInt(th.getAttribute("colspan") || "1", 10) || 1;
        const rowspan = parseInt(th.getAttribute("rowspan") || "1", 10) || 1;
        const text = (th.textContent || "").replace(/\s+/g, " ").trim();
        if (colspan === 1 && text && !headers[col]) headers[col] = text;
        if (rowspan > 1) {
          for (let c = col; c < col + colspan; c++) occupied[c] = (occupied[c] || 0) + (rowspan - 1);
        }
        col += colspan;
      });
    });
    return headers;
  }

  function buildColumnMap() {
    const rootEl = churnRoot();
    let headers = readHeaders(rootEl);
    // Letzte Rückfallebene: liegt der Kopf in einem Container, der mit dem
    // Körper keinen gemeinsamen Vorfahren teilt, dokumentweit suchen. Nur wenn
    // dabei eine plausibel breite Kopfzeile herauskommt – sonst würde die
    // Kopfzeile einer fremden Tabelle die Zuordnung verfälschen.
    if (headers.filter(Boolean).length < 4) {
      const wide = readHeaders(document);
      if (wide.filter(Boolean).length >= 4) headers = wide;
    }
    const firstRow = getDataRows()[0];
    const cellCount = firstRow ? firstRow.querySelectorAll("td").length : 0;
    const map = shared.mapChurnColumns ? shared.mapChurnColumns(headers, cellCount) : {};
    return { map, headers, cellCount };
  }

  // Liest eine Datenzeile anhand der Spaltenzuordnung. Die Sonderzellen (Button,
  // Ant-Select, Anchor) werden gezielt ausgelesen, sonst der reine Zelltext.
  // Ticketnummer einer Zeile. Bewusst NICHT über die Spalte: die Nummer hat eine
  // unverwechselbare Form (TNG-1407030) und hängt meist an einem Link. Das
  // trifft auch dann, wenn die Spalte anders heißt oder verschoben ist – und
  // genau daran scheiterte es vorher, während die Nachbarspalte („nicht
  // erreicht") munter als Grund durchging.
  function readJira(row, jiraCell) {
    const anchors = Array.from((jiraCell || row).querySelectorAll("a"));
    const linked = anchors.find((a) =>
      /\/browse\/[A-Z][A-Z0-9_]+-\d+/i.test(a.getAttribute("href") || a.href || "") ||
      (shared.findJiraKey && shared.findJiraKey(a.textContent || "")));
    if (linked) {
      const key = (shared.findJiraKey && shared.findJiraKey(linked.textContent || "")) || (linked.textContent || "").trim();
      return { ticket: key, href: linked.href || "" };
    }
    // Kein Link: die Nummer aus dem Zelltext, sonst aus der ganzen Zeile.
    const fromCell = jiraCell && shared.findJiraKey ? shared.findJiraKey(jiraCell.textContent || "") : "";
    const key = fromCell || (shared.findJiraKey ? shared.findJiraKey(row.textContent || "") : "");
    return { ticket: key, href: "" };
  }

  function readRow(row, colMap) {
    const tds = Array.from(row.querySelectorAll("td"));
    const cell = (key) => {
      if (!Object.prototype.hasOwnProperty.call(colMap, key)) return null;
      return tds[colMap[key]] || null;
    };
    const text = (key) => {
      const td = cell(key);
      if (!td) return "";
      const column = COLUMNS.find((c) => c.key === key);
      if (column && column.child) {
        const child = td.querySelector(column.child);
        if (child && child.textContent && child.textContent.trim()) return child.textContent.trim();
      }
      return (td.textContent || "").trim();
    };

    const jira = readJira(row, cell("jira"));
    return {
      vertrag: text("vertrag"),
      geschaeftsfall: text("geschaeftsfall"),
      ursache: text("ursache"),
      eingang: text("eingang"),
      winback: text("winback"),
      dealcloser: text("dealcloser"),
      jiraTicket: jira.ticket,
      jiraHref: jira.href,
      kommentar: text("kommentar")
    };
  }

  // ── Ablauf ─────────────────────────────────────────────────────────────────

  // Steht die Churnliste schon? Erkennbar an ihren eigenen Spalten – die
  // Status-Abfrage (Startseite) hat gar keine Tabelle.
  function churnListVisible() {
    const heads = Array.from(document.querySelectorAll("thead th"))
      .map((th) => (th.textContent || "").toLowerCase());
    if (!heads.length) return false;
    return heads.some((text) => /winback|ursache|jira/.test(text));
  }

  // Klickt den Reiter „Churnliste" in der Kopfzeile an. Ohne diesen Schritt
  // landete die Kundennummer im Vertragsfeld der Status-Abfrage – die Abfrage
  // „funktionierte" dann nur, wenn der Reiter zufällig schon offen war.
  async function step_openChurnList() {
    if (churnListVisible()) return;

    const label = (DASH.navLabel || "Churnliste").toLowerCase();
    const link = await shared.waitForCondition(() => {
      const candidates = document.querySelectorAll("nav a, header a, a, [role='tab'], button, li");
      for (const node of candidates) {
        // Nur der Eintrag selbst, nicht ein umschließender Container mit viel Text.
        const text = (node.textContent || "").trim().toLowerCase();
        if (text === label && (shared.isVisible ? shared.isVisible(node) : true)) return node;
      }
      return null;
    }, 8000);

    if (!link) {
      throw new Error(
        `Der Reiter „${DASH.navLabel || "Churnliste"}" wurde im Dashboard nicht gefunden. ` +
        "Bitte prüfen, ob die Seite vollständig geladen und du angemeldet bist."
      );
    }
    link.click();

    const arrived = await shared.waitForCondition(() => churnListVisible(), 12000);
    if (!arrived) throw new Error("Die Churnliste hat sich nicht geöffnet – bitte im Dashboard prüfen.");
    await shared.sleep(400);
  }

  async function runChurnLookup(requestId, kundennummer) {
    if (!kundennummer) throw new Error("Keine Kundennummer angegeben.");

    sendStep(requestId, "nav", "active");
    await step_openChurnList();
    sendStep(requestId, "nav", "done");

    sendStep(requestId, "search", "active");
    const input = await shared.waitForCondition(() => findSearchInput(), 8000);
    if (!input) throw new Error("Suchfeld nicht gefunden – ist das GFIZ-Dashboard wirklich geöffnet und angemeldet?");
    const rowsBefore = getDataRows().length;
    shared.reactSetValue(input, "");
    await shared.sleep(150);
    shared.reactSetValue(input, kundennummer);
    sendStep(requestId, "search", "done");

    sendStep(requestId, "settle", "active");
    // Erst auf eine Reaktion der Tabelle warten (Zeilen, die die Nummer
    // enthalten, oder der Leer-Platzhalter), dann auf Ruhe. Nur „kurz warten und
    // dann zählen" war die eigentliche Fehlerquelle: bei einer Tabelle, die
    // langsamer lädt als die 3 s Fenster, wurde die ALTE Zeilenmenge (oder gar
    // keine) ausgelesen und das Ergebnis als „nichts gefunden" gemeldet.
    const searchAt = Date.now();
    const settled = await shared.waitForCondition(() => {
      // Zeilen zuerst: sie sind der stärkere Beweis. Ant lässt einen
      // Leer-Platzhalter mitunter im DOM stehen, obwohl längst Treffer angezeigt
      // werden – die Reihenfolge verhindert, dass das als „nichts gefunden" gilt.
      const rows = getDataRows();
      if (rows.length) {
        if (rows.some((row) => (row.textContent || "").includes(kundennummer))) return "treffer";
        // Die Tabelle hat sich verändert, ohne die Nummer im Text zu zeigen –
        // auch das ist eine Reaktion (Suche greift über eine andere Spalte).
        if (rows.length !== rowsBefore) return "geaendert";
        return null;
      }
      // Der Leer-Platzhalter steht auch kurz, WÄHREND gefiltert wird. Ihn sofort
      // als Endergebnis zu nehmen hieße: „kein Vorgang gefunden", obwohl die
      // Treffer eine Sekunde später erscheinen. Deshalb erst nach einer
      // Mindestwartezeit als echtes Leerergebnis akzeptieren.
      if (hasEmptyState() && Date.now() - searchAt > 2500) return "leer";
      return null;
    }, 15000, 250);
    if (!settled) {
      // Die Tabelle hat auf die Suche nicht reagiert. Hier NICHT einfach den
      // aktuellen Stand auslesen: das wären die Vorgänge, die vorher schon dort
      // standen – also fremde Kunden. Ein ehrlicher Fehler ist besser als eine
      // Auskunft über die falsche Person.
      shared.reactSetValue(input, "");
      throw new Error(
        `Die Suche nach ${kundennummer} hat im GFIZ-Dashboard nicht gegriffen (die Trefferliste hat sich nicht verändert). ` +
        "Bitte im Dashboard prüfen, ob die Suche dort funktioniert, und erneut versuchen."
      );
    }
    await shared.waitForStableRows(() => getDataRows().length, {
      quietMs: 600, timeoutMs: 6000, intervalMs: 250
    });
    sendStep(requestId, "settle", "done");

    sendStep(requestId, "extract", "active");
    const { map, headers, cellCount } = buildColumnMap();
    const dataRows = getDataRows();
    log("Spaltenzuordnung", map, "| Kopfzeile:", headers, "| Zellen je Zeile:", cellCount);

    // Konnte keine einzige Spalte zugeordnet werden, wären alle Felder leer und
    // das Ergebnis hieße fälschlich „kein Kündigungsvorgang gefunden". Das ist
    // die gefährlichste Variante – lieber ein benannter Fehler mit der
    // Kopfzeile, die tatsächlich gefunden wurde.
    if (dataRows.length && !map.vertrag && !map.ursache && !map.jira) {
      throw new Error(
        "Die Spalten der Churnliste konnten nicht zugeordnet werden" +
        (headers.length ? ` (gefundene Kopfzeile: ${headers.filter(Boolean).join(", ")})` : " – es wurde keine Kopfzeile gefunden") +
        ". Bitte diese Meldung melden, dann wird die Zuordnung angepasst."
      );
    }
    const rows = dataRows.map((row) => readRow(row, map));
    // Suchfeld wieder leeren, damit kein Kundenbezug im Dashboard stehen bleibt.
    shared.reactSetValue(input, "");
    const result = shared.parseChurn({ found: rows.length > 0, kundennummer, rows });
    sendStep(requestId, "extract", "done");
    return result;
  }

  // Steht auf der Seite wirklich das Dashboard (und nicht die Login-/Fehler-
  // seite)? Der Worker fragt das über sc-ping ab, bevor er die Automatisierung
  // startet – siehe CONFIG.lookups.churn.readySelectors.
  function isReady() {
    const selectors = DASH.readySelectors || [];
    if (!selectors.length) return true;
    return selectors.some((selector) => {
      try { return Boolean(document.querySelector(selector)); }
      catch (error) { return false; }
    });
  }

  // Ein zweiter Auftrag, während der erste noch tippt und wartet, würde beide
  // Läufe verderben (zwei Suchbegriffe in einem Feld).
  let busy = false;

  // Startzeitpunkt dieses Scripts. Der Worker setzt den Tab vor jedem Lauf
  // zurück und akzeptiert nur ein Script, das danach gestartet ist – sonst
  // könnte das noch lebende Script der ALTEN Seite den Ping beantworten und wir
  // würden genau den Zustand automatisieren, der verworfen werden sollte.
  const loadedAt = Date.now();

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return false;
      // Erreichbarkeits-Ping – siehe baustatus-content.js. Ein verwaistes
      // Content-Script antwortet nicht; der Worker setzt den Tab dann zurück.
      if (message.type === "sc-ping") {
        sendResponse({ ok: true, pong: true, kind: "churn", ready: isReady(), busy, loadedAt, url: location.href });
        return false;
      }
      if (message.type !== "sc-lookup-churn") return false;
      if (busy) {
        sendResponse({ ok: false, error: "Es läuft bereits eine Abfrage in diesem Tab. Bitte kurz warten." });
        return false;
      }
      busy = true;
      runChurnLookup(message.requestId, String(message.customerNumber || "").trim())
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: (error && error.message) || String(error) }))
        .finally(() => { busy = false; });
      return true; // asynchrone Antwort
    });
  } catch (error) {
    // Chrome-Kontext nicht verfügbar (Extension neu geladen) – Script endet still.
  }
})();
