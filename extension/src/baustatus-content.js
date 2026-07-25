(function initBaustatusScraper() {
  "use strict";

  // Content-Script auf fttx-dash.tng.de: schlägt zu einer Kundennummer den
  // Baustatus (Ausbauphase, Vertrag, Line Status, KVZ, externe Firmen, Adresse,
  // Zeitschienen) nach. Wird NICHT automatisch aktiv – es wartet auf eine
  // sc-lookup-baustatus-Nachricht des Hintergrund-Workers (lookup.js), der nur
  // bei aktivem Schalter + Bestätigung anfragt.
  //
  // Navigation (Top-Suche → Bauabschnitt → Kundenliste → Filter → Extraktion)
  // ist aus dem ursprünglichen Scraper portiert, nutzt aber die gemeinsamen
  // Helfer aus shared.js und meldet Fortschritt per sc-lookup-step. Die
  // Normalisierung der Rohfelder übernimmt der reine Parser shared.parseBaustatus.
  //
  // Hinweis: fttx-dash ist eine Ant-Design/React-Oberfläche. Die Selektoren sind
  // bewusst mehrstufig (Placeholder → id → Struktur) und teils an die Live-UI
  // gebunden – ändert sich das Dashboard, sind hier Anpassungen nötig. Das ist
  // der Preis aktiver Automatisierung; die reinen Parser bleiben davon unberührt.

  const app = globalThis.StadtnetzCRM || {};
  const shared = app.shared || {};

  function log(...args) {
    try { console.log("[Netz-Auskunft/Baustatus]", ...args); } catch (error) { /* egal */ }
  }

  function sendStep(requestId, step, state) {
    try {
      chrome.runtime.sendMessage(
        { type: "sc-lookup-step", requestId, kind: "baustatus", step, state },
        () => void chrome.runtime.lastError
      );
    } catch (error) { /* Worker beendet – Ergebnis wird trotzdem zurückgegeben */ }
  }

  function waitForEl(selector, timeout) {
    return shared.waitForCondition(() => document.querySelector(selector), timeout || 5000);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  // Schritt 1: oben in das Ant-Design-Select „Vertrag" tippen und den exakten
  // Treffer aus dem Dropdown wählen.
  async function step1_topSearch(customerNumber) {
    const input = await shared.waitForCondition(() => {
      const all = document.querySelectorAll('.ant-select-selection-search-input[role="combobox"]');
      for (const inp of all) {
        const sel = inp.closest(".ant-select");
        const ph = sel && sel.querySelector(".ant-select-selection-placeholder");
        if (ph && ph.textContent.trim().toLowerCase() === "vertrag") return inp;
      }
      const header = document.querySelector('header, nav, [class*="bg-primary"]');
      if (header) {
        const hi = header.querySelectorAll('.ant-select-selection-search-input[role="combobox"]');
        if (hi.length) return hi[hi.length - 1];
      }
      return all.length ? all[all.length - 1] : null;
    }, 5000);
    if (!input) throw new Error("Vertrag-Suchfeld nicht gefunden.");

    const wrapper = input.closest(".ant-select") || input.parentElement;
    if (wrapper) wrapper.click();
    await shared.sleep(300);
    input.focus();
    await shared.sleep(200);
    shared.reactSetValue(input, "");
    await shared.sleep(100);
    shared.reactSetValue(input, customerNumber);
    await shared.sleep(800);

    // Exakter Treffer: die Nummer muss von | umschlossen sein, nicht Teil einer
    // größeren Zahl.
    const exact = new RegExp("\\|\\s*" + customerNumber + "\\s*\\|");
    const atEnd = new RegExp("\\|\\s*" + customerNumber + "\\s*$");
    const item = await shared.waitForCondition(() => {
      const options = document.querySelectorAll(
        ".ant-select-item-option, .ant-select-item, .rc-virtual-list-holder-inner > div"
      );
      for (const opt of options) {
        const txt = opt.textContent.trim();
        if (exact.test(txt) || atEnd.test(txt)) return opt;
      }
      return null;
    }, 4000);

    if (item) {
      item.click();
      await shared.sleep(600);
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
      await shared.sleep(500);
    }
  }

  // Schritt 2: das Lupen-Icon anklicken (bestätigt die Suche).
  async function step2_clickSearchIcon() {
    const btn = await shared.waitForCondition(() => {
      const candidates = document.querySelectorAll('span[aria-label="search"], span.anticon-search');
      for (const c of candidates) {
        if (c.getClientRects().length) {
          const inHeader = c.closest('header, nav, [class*="bg-primary"], [class*="justify-between"]');
          if (inHeader) return c;
        }
      }
      for (const c of candidates) {
        if (c.getClientRects().length) return c;
      }
      const svg = document.querySelector('svg[data-icon="search"]');
      return svg || null;
    }, 3000);

    if (btn) {
      let clickTarget = btn;
      while (clickTarget && typeof clickTarget.click !== "function") clickTarget = clickTarget.parentElement;
      if (clickTarget) clickTarget.click();
    } else {
      const inputs = document.querySelectorAll('.ant-select-selection-search-input[role="combobox"]');
      const input = inputs[inputs.length - 1];
      if (input) {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true }));
      }
    }
    await shared.sleep(1500);
  }

  // Schritt 3: den richtigen Bauabschnitt öffnen (Icon-Eintrag in der Leiste).
  async function step3_hammerClick() {
    await shared.waitForCondition(
      () => document.querySelectorAll("div.cursor-pointer.hover\\:bg-zinc-300").length > 0, 6000
    );
    await shared.sleep(400);
    const target = await shared.waitForCondition(() => {
      const SKIP = ["hdd", "menu", "check-circle"];
      const divs = Array.from(document.querySelectorAll("div.cursor-pointer.hover\\:bg-zinc-300"));
      const candidates = divs.filter((d) => {
        const svg = d.querySelector("svg");
        return !SKIP.includes(svg && svg.getAttribute("data-icon"));
      });
      return candidates[candidates.length - 1] || null;
    }, 6000);
    if (target) {
      target.click();
      await shared.sleep(1000);
    } else {
      log("Bauabschnitt nicht gefunden – weiter.");
    }
  }

  // Schritt 4: eingeblendetes Seitenpanel wieder schließen.
  async function step4_dismissPanel() {
    const mask = document.querySelector('.ant-drawer-mask, [class*="drawer-mask"], [class*="overlay"]');
    if (mask) {
      mask.click();
    } else {
      const main = document.querySelector('main, [class*="main-content"], [class*="content-area"]') || document.body;
      main.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: window.innerWidth * 0.7, clientY: 300 }));
    }
    await shared.sleep(700);
  }

  // Schritt 5: zum Reiter „Kundenliste" scrollen und ihn öffnen.
  async function step5_openKundenliste() {
    await shared.waitForCondition(() =>
      window.location.href.includes("/owned/") ||
      window.location.href.includes("/leased/") ||
      document.querySelector('[role="tab"]') !== null
    , 8000);
    await shared.sleep(600);
    window.scrollBy({ top: 300, behavior: "smooth" });
    await shared.sleep(400);

    const tab = await shared.waitForCondition(() => {
      const tabs = document.querySelectorAll('[role="tab"], .ant-tabs-tab, [class*="tab-btn"], [class*="TabItem"]');
      for (const t of tabs) {
        if (t.textContent.trim().toLowerCase().includes("kundenliste")) return t;
      }
      return null;
    }, 8000);
    if (!tab) throw new Error("Reiter „Kundenliste“ nicht gefunden – Bauabschnitt evtl. nicht geöffnet.");
    tab.scrollIntoView({ behavior: "smooth", block: "center" });
    await shared.sleep(300);
    tab.click();
    await shared.sleep(1000);
  }

  // Schritt 6: Kundennummer in das Suchfeld der Kundenliste tippen.
  async function step6_kundenlisteSearch(customerNumber) {
    const input = await waitForEl(
      'input[placeholder*="Client ID"], input[placeholder*="client"], input[placeholder*="Vertrag, Client"]', 5000
    );
    if (!input) throw new Error("Suchfeld der Kundenliste nicht gefunden.");
    shared.reactSetValue(input, customerNumber);
    await shared.sleep(1200);
  }

  // Schritt 7: Gebäudetyp-Filter öffnen, alle drei Typen anhaken, anwenden.
  async function step7_buildingTypeFilter() {
    const filterBtn = await shared.waitForCondition(() => {
      const ths = document.querySelectorAll("th.ant-table-cell, th");
      for (const th of ths) {
        const title = th.querySelector('.ant-table-column-title, [class*="column-title"]');
        const titleText = ((title && title.textContent) || th.textContent).trim().toLowerCase();
        if (titleText.includes("building")) {
          const trigger = th.querySelector('.ant-table-filter-trigger, [class*="filter-trigger"]');
          if (trigger) return trigger;
        }
      }
      return null;
    }, 4000);
    if (!filterBtn) { log("Gebäudetyp-Filter nicht gefunden – überspringe."); return; }

    filterBtn.click();
    await shared.sleep(600);
    const labels = await shared.waitForCondition(() => {
      const dropdown = document.querySelector(".ant-table-filter-dropdown");
      if (!dropdown) return null;
      const items = dropdown.querySelectorAll("label.ant-checkbox-wrapper");
      return items.length ? items : null;
    }, 3000);

    if (labels) {
      const wanted = ["sdu", "mdu tng", "mdu other"];
      for (const item of labels) {
        const labelEl = item.querySelector(".ant-checkbox-label, span:last-child");
        const txt = ((labelEl && labelEl.textContent) || item.textContent).trim().toLowerCase();
        if (wanted.some((v) => txt.includes(v))) {
          const cb = item.querySelector('input.ant-checkbox-input, input[type="checkbox"]');
          if (cb && !cb.checked) { item.click(); await shared.sleep(150); }
        }
      }
    }
    await shared.sleep(300);
    const confirmBtn = await shared.waitForCondition(() => {
      const dropdown = document.querySelector(".ant-table-filter-dropdown, .ant-dropdown:not([style*='display: none'])");
      if (!dropdown) return null;
      for (const b of dropdown.querySelectorAll("button")) {
        for (const s of b.querySelectorAll("span")) {
          if (s.textContent.trim() === "Filter") return b;
        }
      }
      return null;
    }, 2000);
    if (confirmBtn) {
      confirmBtn.click();
      await shared.sleep(800);
    } else {
      const anyPrimary = document.querySelector(".ant-table-filter-dropdown .ant-btn-primary, .ant-dropdown .ant-btn-primary");
      if (anyPrimary) { anyPrimary.click(); await shared.sleep(800); }
    }
  }

  // ── Extraktion (Rohfelder → shared.parseBaustatus) ──────────────────────────

  function extractCompanyName(labelEl) {
    let container = labelEl.parentElement;
    for (let i = 0; i < 4; i++) {
      if (!container) break;
      if (container.children.length >= 2) break;
      container = container.parentElement;
    }
    if (!container) return "";
    const labelText = labelEl.textContent.trim().toLowerCase();
    const valueContainer = Array.from(container.children).find((c) =>
      !c.textContent.trim().toLowerCase().includes(labelText) || c.children.length > 1);
    if (!valueContainer) return "";
    const clone = valueContainer.cloneNode(true);
    clone.querySelectorAll('svg, [class*="anticon"], [class*="icon"]').forEach((el) => el.remove());
    const lines = (clone.innerText || clone.textContent || "").split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("@") && !/^\d[\d\s\-/]+$/.test(l) && !l.includes("@"));
    return lines[0] || "";
  }

  function extractExterneKontakte() {
    const result = { begehungen: "", hausanschlussbau: "", lwlInstallation: "" };
    let section = null;
    for (const el of document.querySelectorAll("*")) {
      if (el.children.length > 0) continue;
      if (el.textContent.trim().toLowerCase() === "externe kontakte") {
        section = el.closest('[class*="flex"]') || (el.parentElement && el.parentElement.parentElement);
        break;
      }
    }
    const walker = document.createTreeWalker(section || document.body, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.children.length > 0) continue;
      const lower = node.textContent.trim().toLowerCase();
      if (lower === "begehungen" || lower === "begehung") result.begehungen = extractCompanyName(node);
      if (lower === "hausanschlussbau") result.hausanschlussbau = extractCompanyName(node);
      if (lower === "lwl installation" || lower === "lwl-installation") result.lwlInstallation = extractCompanyName(node);
    }
    return result;
  }

  function getKVZColorClass(cell) {
    for (const el of cell.querySelectorAll("*")) {
      const cn = el.className || "";
      const st = el.getAttribute("style") || "";
      if (cn.includes("red") || cn.includes("error")) return "red";
      if (cn.includes("yellow") || cn.includes("warn")) return "yellow";
      if (cn.includes("green") || cn.includes("success")) return "green";
      if (st.includes("#f44336") || st.includes("rgb(244,67,54)")) return "red";
      if (st.includes("#ffc107") || st.includes("rgb(255, 193, 7)")) return "yellow";
      if (st.includes("#4caf50") || st.includes("rgb(76, 175, 80)")) return "green";
    }
    return "green";
  }

  function findPhasePredictions(phaseValue) {
    const lines = document.body.innerText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes("ausbauphase")) continue;
      for (let j = i; j < Math.min(i + 100, lines.length); j++) {
        if (!lines[j].toLowerCase().includes(phaseValue.toLowerCase())) continue;
        for (let k = j; k < Math.min(j + 10, lines.length); k++) {
          if (!lines[k].toLowerCase().includes("realisierung")) continue;
          const d = lines[k].match(/(\d{1,2}\.\d{1,2}\.\d{4}\s*-\s*\d{1,2}\.\d{1,2}\.\d{4})/);
          if (d) return "Realisierung\n" + d[1];
          const nd = (lines[k + 1] || "").match(/(\d{1,2}\.\d{1,2}\.\d{4}\s*-\s*\d{1,2}\.\d{1,2}\.\d{4})/);
          if (nd) return "Realisierung\n" + nd[1];
        }
      }
    }
    return "Keine Zeiten vorhanden";
  }

  function findTimelineInfo(section) {
    const lines = document.body.innerText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes("zeiten")) continue;
      for (let j = i; j < Math.min(i + 50, lines.length); j++) {
        if (lines[j].trim().toLowerCase() !== section.toLowerCase()) continue;
        let startDate = "";
        let endDate = "";
        for (let k = j + 1; k < Math.min(j + 8, lines.length); k++) {
          const cl = lines[k].trim();
          if (["tiefbau", "lwl", "ausbauphase", "zeiten"].includes(cl.toLowerCase())) break;
          const sm = cl.match(/start:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i); if (sm) startDate = sm[1];
          const em = cl.match(/ende:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i); if (em) endDate = em[1];
        }
        if (startDate && endDate) return `Start ${startDate}\nEnde ${endDate}`;
        if (startDate) return `Start ${startDate}`;
        return "Keine Zeiten vorhanden";
      }
    }
    return "Keine Zeiten vorhanden";
  }

  function extractAdresse(kontaktCell) {
    const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
    const numPat = "\\d+[a-zA-Z]?(?:\\/\\d+)?";

    if (kontaktCell) {
      const cellLines = (kontaktCell.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean);
      for (const line of cellLines) {
        if (/\b\d{5}\b/.test(line) && new RegExp("\\b" + numPat + "\\b").test(line)) {
          const m = line.match(/^(.+?\s+\d+[a-zA-Z]?(?:\/\d+)?)\s*,?\s*(\d{5}\s+[A-ZÄÖÜa-zäöüß][\wäöüß-]+)/);
          return m ? `${m[1].trim()}, ${m[2].trim()}` : line.trim();
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (/^(Herr|Frau)\s+/i.test(lines[i])) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          if (new RegExp("^.+\\s+" + numPat + ",\\s*\\d{5}\\s+.+$", "i").test(lines[j])) return lines[j].trim();
          if (new RegExp("^.+\\s+" + numPat + ",?\\s*$", "i").test(lines[j]) && lines[j + 1] && /^\d{5}\s+.+$/.test(lines[j + 1])) {
            return lines[j].replace(/,?\s*$/, "").trim() + ", " + lines[j + 1].trim();
          }
        }
      }
    }
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes("anschlussadresse") && lines[i + 1]) return lines[i + 1].trim();
      const m = lines[i].match(/anschlussadresse[:\s]+(.+)/i);
      if (m) return m[1].trim();
    }
    const m = document.body.innerText.match(
      /([A-ZÄÖÜ][a-zäöüß-]+(?:straße|strasse|weg|gasse|allee|platz|ring|damm|chaussee)\s+\d+[a-zA-Z]?(?:\/\d+)?[,\s]+\d{5}\s+[A-ZÄÖÜ][a-zäöüß]+)/
    );
    return m ? m[1].trim() : "";
  }

  // Baut aus der Ergebnistabelle die Rohfelder (Header-Map statt fixer Indizes –
  // robuster als der ursprüngliche 39-Zellen-Ansatz).
  function extractFTTX() {
    const result = {};
    let targetTable = null;
    for (const table of document.querySelectorAll("table")) {
      const th = Array.from(table.querySelectorAll("thead th")).map((h) => h.textContent.trim().toLowerCase());
      if (th.includes("vertrag") && th.includes("vertragsstatus")) { targetTable = table; break; }
    }
    if (!targetTable) return result;

    const headerRows = Array.from(targetTable.querySelectorAll("thead tr"));
    const colMap = {};
    const occupied = {};
    for (let r = 0; r < headerRows.length; r++) {
      let col = 0;
      for (const th of Array.from(headerRows[r].querySelectorAll("th"))) {
        while (occupied[col] && occupied[col] > 0) { occupied[col]--; col++; }
        const colspan = parseInt(th.getAttribute("colspan") || "1", 10);
        const rowspan = parseInt(th.getAttribute("rowspan") || "1", 10);
        const text = th.textContent.trim().toLowerCase();
        if (colspan === 1) colMap[text] = col;
        if (rowspan > 1) {
          for (let c = col; c < col + colspan; c++) occupied[c] = (occupied[c] || 0) + (rowspan - 1);
        }
        col += colspan;
      }
    }

    const firstBodyRow = targetTable.querySelector("tbody tr");
    let checkboxOffset = 0;
    if (firstBodyRow) {
      const firstTd = firstBodyRow.querySelector("td");
      if (firstTd && (firstTd.querySelector('input[type=checkbox]') ||
        (firstTd.textContent.trim() === "" && firstTd.querySelector("span,label,div")))) checkboxOffset = 1;
    }
    for (const key in colMap) colMap[key] += checkboxOffset;

    const bodyRows = Array.from(targetTable.querySelectorAll("tbody tr")).filter((row) => {
      const tds = row.querySelectorAll("td");
      if (!Array.from(tds).some((td) => td.textContent.trim().length > 0)) return false;
      const firstDataTd = tds[checkboxOffset] || tds[0];
      return firstDataTd && !firstDataTd.textContent.trim().toLowerCase().includes("gesamt");
    });
    if (!bodyRows.length) return result;

    const cells = Array.from(bodyRows[0].querySelectorAll("td"));
    const cellText = (key) => {
      const idx = colMap[key];
      return idx === undefined || !cells[idx] ? "" : cells[idx].textContent.trim();
    };
    const cellEl = (key) => {
      const idx = colMap[key];
      return idx === undefined ? null : cells[idx] || null;
    };

    if (cellText("eingangsdatum")) result["Eingangsdatum"] = cellText("eingangsdatum");
    const vertrag = cellText("vertrag");
    if (vertrag) result["Vertrag"] = vertrag.split(/[\s,]/)[0];

    const lineStatusEl = cellEl("line status") || cellEl("linestatus");
    if (lineStatusEl && lineStatusEl.textContent.trim()) result["Line Status"] = lineStatusEl.textContent.trim();

    const clientIdEl = cellEl("client id") || cellEl("clientid");
    if (clientIdEl) {
      const clone = clientIdEl.cloneNode(true);
      clone.querySelectorAll("span,div").forEach((el) => { if (el.children.length === 0 && el.textContent.trim().length <= 5) el.remove(); });
      const numMatch = (clone.textContent || "").trim().match(/\d+/);
      if (numMatch) result["Kundennummer"] = numMatch[0];
    }

    const ausbau = cellText("ausbauphase") || cellText("ausbauphas");
    if (ausbau) {
      result["Ausbauphas"] = ausbau;
      const predictions = findPhasePredictions(ausbau);
      if (predictions) result["Phase Predictions"] = predictions;
    }

    const kvzEl = cellEl("kvz");
    if (kvzEl && kvzEl.textContent.trim()) {
      result["KVZ"] = kvzEl.textContent.trim();
      result["KVZ_COLOR"] = getKVZColorClass(kvzEl);
    }
    if (cellText("building type") || cellText("buildingtype")) result["Building Type"] = cellText("building type") || cellText("buildingtype");
    if (cellText("vertragsstatus")) result["Vertragsstatus"] = cellText("vertragsstatus");

    const tiefbau = findTimelineInfo("Tiefbau");
    const lwl = findTimelineInfo("LWL");
    if (tiefbau) result["Tiefbau Timeline"] = tiefbau;
    if (lwl) result["LWL Timeline"] = lwl;

    const contacts = extractExterneKontakte();
    if (contacts.begehungen) result["BG Firma"] = contacts.begehungen;
    if (contacts.hausanschlussbau) result["HAB Firma"] = contacts.hausanschlussbau;
    if (contacts.lwlInstallation) result["LWL Firma"] = contacts.lwlInstallation;

    const kontaktCell = cellEl("kontaktdaten (hauptvertragsnehmer & anschlussadresse)")
      || cellEl("kontaktdaten") || cellEl("anschlussadresse") || cellEl("kontakt");
    const adresse = extractAdresse(kontaktCell);
    if (adresse) result["Adresse"] = adresse;

    return result;
  }

  async function runBaustatusLookup(requestId, customerNumber) {
    if (!customerNumber) throw new Error("Keine Kundennummer angegeben.");

    sendStep(requestId, "search", "active");
    await step1_topSearch(customerNumber);
    sendStep(requestId, "search", "done");

    sendStep(requestId, "confirm", "active");
    await step2_clickSearchIcon();
    sendStep(requestId, "confirm", "done");

    sendStep(requestId, "hammer", "active");
    await step3_hammerClick();
    sendStep(requestId, "hammer", "done");

    sendStep(requestId, "dismiss", "active");
    await step4_dismissPanel();
    sendStep(requestId, "dismiss", "done");

    sendStep(requestId, "kundenliste", "active");
    await step5_openKundenliste();
    sendStep(requestId, "kundenliste", "done");

    sendStep(requestId, "klsearch", "active");
    await step6_kundenlisteSearch(customerNumber);
    sendStep(requestId, "klsearch", "done");

    sendStep(requestId, "filter", "active");
    await step7_buildingTypeFilter();
    sendStep(requestId, "filter", "done");

    sendStep(requestId, "extract", "active");
    await shared.sleep(800);
    const raw = extractFTTX();
    const result = shared.parseBaustatus(raw);
    sendStep(requestId, "extract", "done");
    return result;
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message) return false;
      // Erreichbarkeits-Ping des Hintergrund-Workers: ein frisch geladenes
      // Content-Script mit gültigem Kontext antwortet sofort. Bleibt die
      // Antwort aus, weiß der Worker (lookup.js), dass hier ein verwaistes
      // Script hängt (Extension neu geladen, dieser Tab aber nicht) und lädt
      // den Tab einmal neu, statt stumm in den Timeout zu laufen.
      if (message.type === "sc-ping") { sendResponse({ ok: true, pong: true, kind: "baustatus" }); return false; }
      if (message.type !== "sc-lookup-baustatus") return false;
      runBaustatusLookup(message.requestId, String(message.customerNumber || "").trim())
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) => sendResponse({ ok: false, error: (error && error.message) || String(error) }));
      return true; // asynchrone Antwort
    });
  } catch (error) {
    // Chrome-Kontext nicht verfügbar (Extension neu geladen) – Script endet still.
  }
})();
