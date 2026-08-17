(function initStadtnetzCRMSupabase() {
  "use strict";

  // globalThis statt window: identisch im Content-Script, siehe config.js/shared.js.
  globalThis.StadtnetzCRM = globalThis.StadtnetzCRM || {};
  const app = globalThis.StadtnetzCRM;
  const CONFIG = app.CONFIG || {};
  const shared = app.shared || {};
  const extensionAlive = shared.extensionAlive || (() => true);

  // Ohne frisches Token spätestens so viele ms vor Ablauf erneuern, statt erst
  // beim tatsächlichen 401 zu merken, dass die Sitzung abgelaufen ist.
  const SESSION_REFRESH_SKEW_MS = 60000;

  // ---------------------------------------------------------------------------
  // Login-Ableitung — Stufe 1 aus KONZEPT-INTEGRATION.md, Option (a): die
  // Extension bekommt eine eigene Supabase-Session, aber dieselben Name+PIN-
  // Zugangsdaten wie das CRM. Muss deshalb Zeichen für Zeichen dieselbe
  // Ableitung liefern wie pinToPassword()/nameToEmail() in src/lib/supabase.ts
  // (CRM-Repo) — sonst schlägt der Login mit korrekten Zugangsdaten fehl.
  // ---------------------------------------------------------------------------

  function pinToPassword(name, pin) {
    const key = String(name == null ? "" : name).trim().toLowerCase();
    return `tng-crm::${key}::${pin}`;
  }

  function nameToEmail(name) {
    const key = String(name == null ? "" : name).trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
    return `${key}@crm.tng.local`;
  }

  // ---------------------------------------------------------------------------
  // Reine Parser/Prüf-Funktionen — kein fetch, direkt testbar (siehe
  // test/supabase.test.js).
  // ---------------------------------------------------------------------------

  // GoTrue-Antwort (POST .../auth/v1/token) in eine lokale Session übersetzen.
  function parseTokenResponse(json, now) {
    if (!json || !json.access_token || !json.refresh_token) return null;
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: (now || Date.now()) + expiresIn * 1000,
      userId: (json.user && json.user.id) || null,
      email: (json.user && json.user.email) || null
    };
  }

  // true, wenn die Sitzung abgelaufen ist ODER innerhalb der Refresh-Vorlauf-
  // frist (skewMs) abläuft — beides löst einen Refresh vor dem nächsten Aufruf aus.
  function isSessionExpired(session, now, skewMs) {
    if (!session || typeof session.expiresAt !== "number") return true;
    const skew = typeof skewMs === "number" ? skewMs : SESSION_REFRESH_SKEW_MS;
    return (now || Date.now()) + skew >= session.expiresAt;
  }

  // Antwort der customer_card()-RPC normalisieren. null bleibt null (Signal
  // "im CRM nicht bekannt" aus der DB-Funktion, siehe Migration 017).
  function parseCustomerCardResponse(json) {
    if (!json || typeof json !== "object") return null;
    return {
      customerNumber: json.customerNumber || "",
      name: json.name || "",
      phone: json.phone || "",
      firstSeenAt: json.firstSeenAt || "",
      lastContactAt: json.lastContactAt || "",
      contractCount: Number(json.contractCount) || 0,
      tariffChangeCount: Number(json.tariffChangeCount) || 0,
      noteCount: Number(json.noteCount) || 0,
      leadCount: Number(json.leadCount) || 0,
      jiraTicket: json.jiraTicket || ""
    };
  }

  // ---------------------------------------------------------------------------
  // Stufe 3 (KONZEPT-INTEGRATION.md, "Ein Gespräch, eine Erfassung") — Payload-
  // Builder für den Abschluss eines Anrufs. Feldnamen exakt nach den
  // insertContract()/insertTariffChange()/insertNote()/insertLead()-
  // Gegenstücken in src/lib/supabaseApi.ts (CRM-Repo): snake_case, leere
  // Strings werden zu null. Reine Funktionen, kein fetch — direkt testbar.
  // ---------------------------------------------------------------------------

  function buildNotePayload(fields, createdBy, nowIso) {
    const now = nowIso || new Date().toISOString();
    const f = fields || {};
    return {
      customer_number: f.customerNumber || null,
      customer_name: f.customerName || null,
      title: f.title || "",
      content: f.content || "",
      jira_ticket: f.jiraTicket || null,
      created_at: now,
      updated_at: now,
      created_by: createdBy || null
    };
  }

  function buildLeadPayload(fields, createdBy) {
    const f = fields || {};
    return {
      customer_name: f.customerName || "",
      customer_number: f.customerNumber || null,
      phone: f.phone || null,
      topic: f.topic || null,
      status: f.status || "neu",
      priority: f.priority || "normal",
      follow_up_date: f.followUpDate || null,
      notes: f.notes || null,
      created_by: createdBy || null
    };
  }

  function buildContractPayload(fields, createdBy) {
    const f = fields || {};
    return {
      customer_number: f.customerNumber || "",
      customer_name: f.customerName || "",
      products: Array.isArray(f.products) ? f.products : [],
      contract_date: f.contractDate || "",
      status: f.contractStatus || "aktiv",
      jira_ticket: f.jiraTicket || null,
      follow_up_date: f.followUpDate || null,
      laufzeit_monate: f.laufzeitMonate ?? null,
      notes: f.notes || null,
      created_by: createdBy || null
    };
  }

  function buildTariffChangePayload(fields, createdBy) {
    const f = fields || {};
    return {
      customer_number: f.customerNumber || "",
      customer_name: f.customerName || "",
      change_type: f.changeType || null,
      context: f.context || null,
      old_product: f.oldProduct || null,
      new_product: f.newProduct || null,
      change_date: f.changeDate || "",
      jira_ticket: f.jiraTicket || null,
      notes: f.notes || null,
      exported_at: null,
      created_by: createdBy || null
    };
  }

  // ---------------------------------------------------------------------------
  // Ticket-Zusammenfassung für die Kundenakte
  //
  // Wer im CRM eine Kundenakte öffnet, soll den Stand aus Jira dort vorfinden,
  // ohne selbst nach dem Ticket zu suchen: die KI-Zusammenfassung als Notiz,
  // mit der Angabe, ob das Ticket noch offen oder schon geschlossen ist.
  //
  // Bewusst EINE Notiz je Ticket (nicht je Zusammenfassung): beim erneuten
  // Zusammenfassen — und genau das passiert, wenn sich am Ticket etwas
  // geändert hat — wird dieselbe Zeile aktualisiert. Sonst würde die Akte bei
  // jedem Ticket-Aufruf zuwachsen, statt den aktuellen Stand zu zeigen.
  // Erkennungsmerkmal für "dieselbe Zeile" ist jira_ticket + dieser Titel.
  // ---------------------------------------------------------------------------

  const TICKET_SUMMARY_TITLE_PREFIX = "Ticket-Zusammenfassung";

  function ticketSummaryNoteTitle(ticketKey) {
    const key = String(ticketKey || "").trim();
    return key ? `${TICKET_SUMMARY_TITLE_PREFIX} ${key}` : TICKET_SUMMARY_TITLE_PREFIX;
  }

  // Statuszeile der Notiz: die Ableitung (Offen/Geschlossen) zuerst, weil sie
  // in der Akte die eigentliche Frage beantwortet; der Original-Jira-Status
  // steht in Klammern dahinter, damit die Ableitung nachvollziehbar bleibt.
  function ticketSummaryStatusLine(resolution) {
    const res = resolution || {};
    const label = res.label || "Unbekannt";
    return res.raw && res.raw !== label ? `Status: ${label} (${res.raw})` : `Status: ${label}`;
  }

  function ticketSummaryNoteContent(input, nowIso) {
    const i = input || {};
    const stamp = new Date(nowIso || Date.now()).toLocaleString("de-DE");
    const lines = [ticketSummaryStatusLine(i.resolution)];
    if (i.ticketTitle) lines.push(`Anliegen: ${i.ticketTitle}`);
    lines.push("", String(i.summary || "").trim(), "");
    lines.push(`Automatisch aus Jira übernommen (${i.ticketKey || "ohne Ticket"}), Stand ${stamp}.`);
    return lines.join("\n");
  }

  // Reiner Builder: aus Ticket + Zusammenfassung die Felder, die insertNote()
  // ohnehin erwartet (siehe buildNotePayload oben).
  function buildTicketSummaryNoteFields(input, nowIso) {
    const i = input || {};
    return {
      customerNumber: String(i.customerNumber || "").trim(),
      customerName: String(i.customerName || "").trim(),
      title: ticketSummaryNoteTitle(i.ticketKey),
      content: ticketSummaryNoteContent(i, nowIso),
      jiraTicket: String(i.ticketKey || "").trim()
    };
  }

  // Gleiche Form wie insertAuditLog() in src/lib/supabaseApi.ts (CRM-Repo).
  // created_at bewusst nicht gesetzt — die Tabelle hat einen DB-Default.
  function buildAuditLogPayload(entry, actorId, actorName) {
    const e = entry || {};
    return {
      actor_id: actorId || null,
      actor_name: actorName || "",
      action: e.action,
      entity_type: e.entityType,
      entity_id: e.entityId ?? null,
      entity_label: e.entityLabel ?? null,
      details: e.details ?? null
    };
  }

  // shared_settings-Zeile (Produktkatalog + Provisions-Matrix) normalisieren.
  function parseSharedSettingsResponse(row) {
    if (!row || typeof row !== "object") return null;
    return {
      products: Array.isArray(row.products) ? row.products : [],
      tariffCommission: row.tariff_commission && typeof row.tariff_commission === "object"
        ? row.tariff_commission
        : {}
    };
  }

  // ---------------------------------------------------------------------------
  // Storage — eigene Wrapper wie in ui.js/timio-content.js (kein gemeinsamer
  // Helfer in shared.js, siehe dortige Konvention).
  // ---------------------------------------------------------------------------

  function safeLocalGet(keys) {
    return new Promise((resolve) => {
      if (!extensionAlive() || !chrome.storage || !chrome.storage.local) return resolve({});
      try {
        chrome.storage.local.get(keys, (data) => resolve(data || {}));
      } catch (error) {
        resolve({});
      }
    });
  }

  function safeLocalSet(payload) {
    if (!extensionAlive()) return;
    try {
      if (chrome.storage && chrome.storage.local) chrome.storage.local.set(payload);
    } catch (error) { /* alte Instanz – nicht mehr schreiben */ }
  }

  function safeLocalRemove(keys) {
    if (!extensionAlive()) return;
    try {
      if (chrome.storage && chrome.storage.local) chrome.storage.local.remove(keys);
    } catch (error) { /* alte Instanz – nicht mehr schreiben */ }
  }

  // CONFIG.supabase liefert den Default (ein vorkonfiguriertes Projekt), die
  // Einstellungen erlauben pro Installation ein Überschreiben — analog zu
  // customerSearchJql. Platzhalterwerte gelten als "nicht konfiguriert".
  async function getEffectiveSupabaseConfig() {
    const defaults = CONFIG.supabase || {};
    const saved = await safeLocalGet([CONFIG.storageKeys.settings]);
    const settings = (saved && saved[CONFIG.storageKeys.settings]) || {};
    const url = String((settings.supabaseUrl || defaults.url || "")).trim();
    const anonKey = String((settings.supabaseAnonKey || defaults.anonKey || "")).trim();
    if (!url || !anonKey || url.includes("YOUR-PROJECT-REF") || anonKey === "YOUR-ANON-KEY") return null;
    return { url: url.replace(/\/+$/, ""), anonKey };
  }

  async function loadSession() {
    const saved = await safeLocalGet([CONFIG.storageKeys.supabaseSession]);
    return saved[CONFIG.storageKeys.supabaseSession] || null;
  }

  function saveSession(session) {
    safeLocalSet({ [CONFIG.storageKeys.supabaseSession]: session });
  }

  function clearSession() {
    safeLocalRemove([CONFIG.storageKeys.supabaseSession]);
  }

  // ---------------------------------------------------------------------------
  // Netzwerk — GoTrue (Login/Refresh) und PostgREST (customer_card-RPC). Reiner
  // fetch()-Client, kein npm-Paket: die Extension hat keinen Build-Schritt.
  // ---------------------------------------------------------------------------

  async function requestToken(config, queryString, body) {
    const res = await fetch(`${config.url}/auth/v1/token?${queryString}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.anonKey },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (json && (json.error_description || json.msg || json.error)) || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return json;
  }

  async function login(name, pin) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    try {
      const json = await requestToken(config, "grant_type=password", {
        email: nameToEmail(name),
        password: pinToPassword(name, pin)
      });
      const session = parseTokenResponse(json);
      if (!session) return { ok: false, reason: "error", error: "Unerwartete Antwort vom Login." };
      session.displayName = String(name == null ? "" : name).trim();
      saveSession(session);
      return { ok: true, session };
    } catch (error) {
      const message = String((error && error.message) || error);
      const reason = /invalid/i.test(message) ? "invalid-credentials" : "network";
      return { ok: false, reason, error: message };
    }
  }

  function logout() {
    clearSession();
  }

  async function refreshSession(session) {
    const config = await getEffectiveSupabaseConfig();
    if (!config || !session || !session.refreshToken) return null;
    try {
      const json = await requestToken(config, "grant_type=refresh_token", {
        refresh_token: session.refreshToken
      });
      const refreshed = parseTokenResponse(json);
      if (!refreshed) return null;
      refreshed.displayName = session.displayName;
      saveSession(refreshed);
      return refreshed;
    } catch (error) {
      // Refresh-Token ist nicht mehr gültig (z. B. rotiert/widerrufen) —
      // sauber abmelden statt mit einer toten Sitzung weiterzuarbeiten.
      clearSession();
      return null;
    }
  }

  // Genau EIN Refresh gleichzeitig. Supabase/GoTrue rotiert Refresh-Tokens
  // (jeder ist einmalig einlösbar) — feuern mehrere Aufrufer im selben Tick
  // (z. B. maybeLookupCustomer + maybeStartCall + maybeEndCall in einem
  // timio-content.js-Tick) parallel refreshSession(), löst nur der erste den
  // Token ein; der zweite bekommt vom Server einen Fehler und würde in
  // refreshSession() clearSession() aufrufen — und damit die Sitzung löschen,
  // die der erste gerade frisch gespeichert hat. Folge: sporadisches
  // "not-logged-in" beim nächsten Schreibvorgang, obwohl niemand ausgeloggt
  // ist. Das gemeinsame In-Flight-Promise verhindert genau diesen Wettlauf.
  let refreshInFlight = null;

  async function ensureFreshSession() {
    const session = await loadSession();
    if (!session) return null;
    if (!isSessionExpired(session)) return session;
    if (!refreshInFlight) {
      refreshInFlight = refreshSession(session).finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  // Zentraler Lookup für die Kundenakte. Strukturierte Rückgabe statt Throw,
  // damit Aufrufer (timio-content.js) bei jedem Zustand sauber degradieren
  // können, statt zu crashen.
  async function customerCard(customerNumber) {
    const number = String(customerNumber == null ? "" : customerNumber).trim();
    if (!number) return { ok: false, reason: "error", error: "Keine Kundennummer." };

    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    try {
      const res = await fetch(`${config.url}/rest/v1/rpc/customer_card`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ p_customer_number: number })
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }

      const json = await res.json().catch(() => null);
      return { ok: true, data: parseCustomerCardResponse(json) };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Anruf-Start (Stufe 2, KONZEPT-INTEGRATION.md): wird von timio-content.js
  // aufgerufen, sobald ein Anruf sichtbar wird (klingelt/verbindet). agent_id
  // wird explizit aus der Session gesetzt (gleiche Konvention wie
  // insertContract() im CRM: der Client setzt created_by/agent_id selbst,
  // kein DB-Default) — RLS verlangt ohnehin auth.uid() = agent_id.
  async function startCall({ customerNumber, callerName, callerNumber, direction, queueGroup }) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    try {
      const res = await fetch(`${config.url}/rest/v1/calls`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          customer_number: customerNumber || null,
          caller_name: callerName || null,
          caller_number: callerNumber || null,
          direction,
          queue_group: queueGroup || null,
          agent_id: session.userId
        })
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }

      const rows = await res.json().catch(() => null);
      const id = Array.isArray(rows) && rows[0] && rows[0].id;
      if (!id) return { ok: false, reason: "error", error: "Anruf angelegt, aber keine ID erhalten." };
      return { ok: true, id };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Anruf-Abschluss: setzt ended_at/duration_s auf einen bereits angelegten
  // Anruf. Best-effort — schlägt der Request fehl, bleibt die Zeile offen
  // (ended_at null); die Live-Anrufleiste im CRM federt das über einen
  // Staleness-Filter ab (siehe src/components/LiveCallBar.tsx).
  async function endCall(callId, { endedAt, durationS }) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    try {
      const res = await fetch(`${config.url}/rest/v1/calls?id=eq.${encodeURIComponent(callId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        },
        // Wird auch beim Entladen des timio-Tabs aufgerufen (pagehide in
        // timio-content.js). Ohne keepalive bricht der Browser den Request beim
        // Schließen ab und die Zeile bliebe ohne ended_at zurück.
        keepalive: true,
        body: JSON.stringify({ ended_at: endedAt, duration_s: durationS })
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Gesprächsergebnis auf einen bereits angelegten Anruf schreiben (Migration
  // 021): disposition (gehalten/gekündigt/…), Kündigungsgrund und Kampagne.
  // Ergänzt endCall() um die strukturierten Auswertungsfelder — bewusst
  // getrennt, weil die Disposition erst beim Abschluss durch den Bearbeiter
  // feststeht, endCall() aber schon beim Auflegen läuft. Best-effort wie
  // endCall(): scheitert es, bleibt der Anruf ohne Disposition (zählt dann in
  // der Auswertung als „nicht entschieden"), stört aber nichts.
  async function patchCallDisposition(callId, { disposition, cancellationReason, campaignId }) {
    if (!callId) return { ok: false, reason: "error", error: "Keine Anruf-ID." };
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const body = {};
    if (disposition !== undefined) body.disposition = disposition || null;
    if (cancellationReason !== undefined) body.cancellation_reason = cancellationReason || null;
    if (campaignId !== undefined) body.campaign_id = campaignId || null;

    try {
      const res = await fetch(`${config.url}/rest/v1/calls?id=eq.${encodeURIComponent(callId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify(body)
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Aktuelle Schicht + Kampagne des eingeloggten Agenten (Outbound-Umbau,
  // Migration 019/020/025). Bestimmt den Call-Typ (churn/welcome/prl/dupe/
  // bvw/courtesy/other) für das automatische Skript-Routing im Cockpit.
  // automatische Skript-Routing im Cockpit. Liest die shifts-Zeile für heute
  // und joint über den PostgREST-Embed die zugehörige campaign. Strukturierte
  // Rückgabe statt Throw, damit das Cockpit ohne Schicht (kein Eintrag,
  // Migration noch nicht eingespielt) einfach auf den manuellen Umschalter
  // zurückfällt. `dateKey` optional (Testbarkeit) — Default ist heute lokal.
  function localDateKey(d) {
    const dt = d || new Date();
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    return `${dt.getFullYear()}-${mm}-${dd}`;
  }

  async function fetchCurrentShift(dateKey) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const day = dateKey || localDateKey();
    const query =
      `select=shift_type,shift_date,campaign_id,campaigns(id,name,call_type,active)` +
      `&user_id=eq.${encodeURIComponent(session.userId || "")}` +
      `&shift_date=eq.${encodeURIComponent(day)}` +
      `&limit=1`;

    try {
      const res = await fetch(`${config.url}/rest/v1/shifts?${query}`, {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        }
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }

      const rows = await res.json().catch(() => null);
      const row = Array.isArray(rows) && rows[0];
      if (!row) return { ok: true, data: null };

      const campaign = row.campaigns || null;
      return {
        ok: true,
        data: {
          shiftType: row.shift_type || null,
          campaignId: row.campaign_id || null,
          campaignName: (campaign && campaign.name) || null,
          // call_type bestimmt Skript/Einwandkarten; ohne Kampagne kein Typ.
          callType: (campaign && campaign.call_type) || null
        }
      };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // ---------------------------------------------------------------------------
  // Optik aus dem CRM (Migration 022, user_settings.theme_pref/palette)
  // ---------------------------------------------------------------------------

  /**
   * Liest das im CRM gewählte Farbschema des angemeldeten Users. Zurück kommt
   * der ROHE Wert der `palette`-Spalte — die Übersetzung ins Rollen-Schema
   * dieser Extension macht themeEngine.crmPaletteToTheme(), damit die
   * Netzwerkschicht nichts über Farben wissen muss.
   *
   * `theme_pref` (hell/dunkel/system) wird bewusst mitgelesen, aber nicht
   * angewandt: das Panel folgt via @media(prefers-color-scheme) dem
   * Betriebssystem, und ein Inline-Override für alle Rollen würde diesen
   * Automatismus abschalten (siehe applyTheme in src/theme.js). Der Wert steht
   * für eine spätere Entscheidung zur Verfügung.
   *
   * Fehlt die Zeile, ist das kein Fehler: `data` ist dann null und heißt „im
   * CRM noch nie eine Farbe gewählt".
   */
  async function fetchUserAppearance() {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const query =
      `select=theme_pref,palette` +
      `&user_id=eq.${encodeURIComponent(session.userId || "")}` +
      `&limit=1`;

    try {
      const res = await fetch(`${config.url}/rest/v1/user_settings?${query}`, {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        }
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }

      const rows = await res.json().catch(() => null);
      const row = Array.isArray(rows) && rows[0];
      if (!row) return { ok: true, data: null };

      return {
        ok: true,
        data: {
          themePref: row.theme_pref || null,
          palette: row.palette || null
        }
      };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Interner Helfer für die neuen Stufe-3-Inserts: config/session werden vom
  // Aufrufer übergeben (statt hier erneut aufgelöst), damit ein Aufruf, der
  // zusätzlich created_by/agent_id aus der Session braucht, sie nicht zweimal
  // laden muss. Nicht exportiert — customerCard()/startCall()/endCall()
  // bleiben bewusst unangetastet, dies ist nur für die neuen Inserts.
  async function insertRow(config, session, table, payload) {
    try {
      const res = await fetch(`${config.url}/rest/v1/${table}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`,
          Prefer: "return=representation"
        },
        body: JSON.stringify(payload)
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }

      const rows = await res.json().catch(() => null);
      const row = Array.isArray(rows) && rows[0];
      if (!row) return { ok: false, reason: "error", error: "Eintrag angelegt, aber keine Zeile erhalten." };
      return { ok: true, id: row.id, row };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Protokolliert eine Aktion im audit_log (DSGVO Art. 30) — dieselbe Pflicht,
  // der logAudit() im CRM für jeden Vertrag/Notiz/Lead/Tarifwechsel schon
  // nachkommt. Schreiben über die Extension läuft an useStore.ts vorbei, ohne
  // diese Funktion entstünde eine Lücke im Audit-Trail für extension-erfasste
  // Einträge. Fire-and-forget vom Aufrufer erwartet: ein Fehler hier darf die
  // eigentliche Erfassung nie blockieren.
  async function insertAuditLog(entry) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const payload = buildAuditLogPayload(entry, session.userId, session.displayName);
    return insertRow(config, session, "audit_log", payload);
  }

  async function insertNote(fields) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const payload = buildNotePayload(fields, session.userId);
    const res = await insertRow(config, session, "notes", payload);
    if (res.ok) {
      insertAuditLog({
        action: "create",
        entityType: "note",
        entityId: res.id,
        entityLabel: (fields && (fields.customerName || fields.title)) || "",
        details: { source: "extension" }
      }).catch(() => {});
    }
    return res;
  }

  // Gegenstück zu insertRow für die Aktualisierung einer bekannten Zeile.
  // Liefert reason "no-row", wenn PostgREST nichts zurückgibt: die Zeile
  // existiert zwar, darf aber laut RLS ("notes update own", Migration 001)
  // von diesem Login nicht geändert werden — der Aufrufer legt dann eine
  // eigene an, statt den Eintrag einer Kollegin zu überschreiben.
  async function updateRow(config, session, table, id, payload) {
    try {
      const res = await fetch(`${config.url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`,
          Prefer: "return=representation"
        },
        body: JSON.stringify(payload)
      });

      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }

      const rows = await res.json().catch(() => null);
      const row = Array.isArray(rows) && rows[0];
      if (!row) return { ok: false, reason: "no-row" };
      return { ok: true, id: row.id, row };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Sucht die eigene Zusammenfassungs-Notiz zu diesem Ticket. created_by wird
  // mitgefiltert, damit gar nicht erst versucht wird, die Notiz einer anderen
  // Person zu aktualisieren (die RLS würde das ohnehin ablehnen).
  async function findOwnTicketSummaryNote(config, session, ticketKey, title) {
    const query = [
      `jira_ticket=eq.${encodeURIComponent(ticketKey)}`,
      `title=eq.${encodeURIComponent(title)}`,
      `created_by=eq.${encodeURIComponent(session.userId || "")}`,
      "select=id",
      "order=created_at.asc",
      "limit=1"
    ].join("&");

    try {
      const res = await fetch(`${config.url}/rest/v1/notes?${query}`, {
        method: "GET",
        headers: { apikey: config.anonKey, Authorization: `Bearer ${session.accessToken}` }
      });
      if (res.status === 401) {
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }
      const rows = await res.json().catch(() => null);
      const row = Array.isArray(rows) && rows[0];
      return { ok: true, id: (row && row.id) || null };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Schreibt die Zusammenfassung des gerade gelesenen Jira-Tickets in die
  // Kundenakte — als neue Notiz oder, wenn für dieses Ticket schon eine eigene
  // existiert, als Aktualisierung derselben Zeile. Ohne Kundennummer wird
  // nichts geschrieben: eine Notiz ohne Kundenbezug taucht in keiner Akte auf
  // und wäre nur ein Datensatz ohne Zweck.
  async function upsertTicketSummaryNote(input) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const fields = buildTicketSummaryNoteFields(input);
    if (!fields.customerNumber) return { ok: false, reason: "no-customer" };
    if (!fields.jiraTicket) return { ok: false, reason: "no-ticket" };

    const found = await findOwnTicketSummaryNote(config, session, fields.jiraTicket, fields.title);
    if (!found.ok && found.reason === "not-logged-in") return found;

    if (found.ok && found.id) {
      const patched = await updateRow(config, session, "notes", found.id, {
        customer_number: fields.customerNumber,
        customer_name: fields.customerName || null,
        title: fields.title,
        content: fields.content,
        updated_at: new Date().toISOString()
      });
      if (patched.ok) {
        insertAuditLog({
          action: "update",
          entityType: "note",
          entityId: patched.id,
          entityLabel: fields.customerName || fields.title,
          details: { source: "extension", origin: "jira-summary", ticket: fields.jiraTicket, resolution: (input && input.resolution && input.resolution.id) || "" }
        }).catch(() => {});
        return { ok: true, id: patched.id, created: false };
      }
      // "no-row" (fremde Notiz) fällt bewusst auf den Insert unten durch,
      // jeder andere Fehler wird gemeldet.
      if (patched.reason !== "no-row") return patched;
    }

    const payload = buildNotePayload(fields, session.userId);
    const res = await insertRow(config, session, "notes", payload);
    if (res.ok) {
      insertAuditLog({
        action: "create",
        entityType: "note",
        entityId: res.id,
        entityLabel: fields.customerName || fields.title,
        details: { source: "extension", origin: "jira-summary", ticket: fields.jiraTicket, resolution: (input && input.resolution && input.resolution.id) || "" }
      }).catch(() => {});
      return { ok: true, id: res.id, created: true };
    }
    return res;
  }

  async function insertLead(fields) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const payload = buildLeadPayload(fields, session.userId);
    const res = await insertRow(config, session, "leads", payload);
    if (res.ok) {
      insertAuditLog({
        action: "create",
        entityType: "lead",
        entityId: res.id,
        entityLabel: (fields && fields.customerName) || "",
        details: { source: "extension" }
      }).catch(() => {});
    }
    return res;
  }

  async function insertContract(fields) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const payload = buildContractPayload(fields, session.userId);
    const res = await insertRow(config, session, "contracts", payload);
    if (res.ok) {
      insertAuditLog({
        action: "create",
        entityType: "contract",
        entityId: res.id,
        entityLabel: (fields && fields.customerName) || "",
        details: { source: "extension" }
      }).catch(() => {});
    }
    return res;
  }

  async function insertTariffChange(fields) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const payload = buildTariffChangePayload(fields, session.userId);
    const res = await insertRow(config, session, "tariff_changes", payload);
    if (res.ok) {
      insertAuditLog({
        action: "create",
        entityType: "tariff_change",
        entityId: res.id,
        entityLabel: (fields && fields.customerName) || "",
        details: { source: "extension" }
      }).catch(() => {});
    }
    return res;
  }

  // Produktkatalog + Provisions-Matrix — ändern sich selten (nur manuell im
  // CRM-Einstellungsbildschirm), deshalb ein Modul-Cache ohne TTL statt bei
  // jedem Öffnen des Abschluss-Panels neu zu laden.
  let sharedSettingsCache = null; // { data }

  async function fetchSharedSettings(opts) {
    const forceRefresh = Boolean(opts && opts.forceRefresh);
    if (sharedSettingsCache && !forceRefresh) {
      return { ok: true, data: sharedSettingsCache.data, cached: true };
    }

    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };

    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    try {
      const res = await fetch(`${config.url}/rest/v1/shared_settings?id=eq.1&select=products,tariff_commission`, {
        method: "GET",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        }
      });

      if (res.status === 401) {
        // Ein abgelaufenes Login ist ein Signal, das nicht durch einen
        // vorhandenen Cache überdeckt werden darf.
        clearSession();
        return { ok: false, reason: "not-logged-in" };
      }
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        const error = (errJson && errJson.message) || `HTTP ${res.status}`;
        if (sharedSettingsCache) return { ok: true, data: sharedSettingsCache.data, cached: true, stale: true };
        return { ok: false, reason: "error", error };
      }

      const rows = await res.json().catch(() => null);
      const data = parseSharedSettingsResponse(Array.isArray(rows) && rows[0]);
      if (!data) return { ok: false, reason: "error", error: "Keine Einstellungen gefunden." };
      sharedSettingsCache = { data };
      return { ok: true, data, cached: false };
    } catch (error) {
      // Kurzer Netzwerk-Hänger soll Vertrag/Tarifwechsel nicht blockieren,
      // solange schon einmal erfolgreich geladen wurde.
      if (sharedSettingsCache) return { ok: true, data: sharedSettingsCache.data, cached: true, stale: true };
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // ---------------------------------------------------------------------------
  // Befehlspalette (Stufe 4, KONZEPT-INTEGRATION.md) — Live-Suche über
  // customers/contracts/tariff_changes/notes. Keine neue RLS-Policy nötig:
  // "customers read all"/"contracts read all"/"tariff read all"/"notes read
  // all" (db/schema.sql) erlauben bereits jedem auth_is_active()-Nutzer
  // Lesezugriff — die Extension-Session aus Stufe 1 qualifiziert sich
  // genauso wie ein CRM-Tab.
  // ---------------------------------------------------------------------------

  // Entfernt Zeichen, die die PostgREST-`or=(...)`-Syntax sprengen würden
  // (Kommas trennen Bedingungen, Klammern gruppieren) — analog zum
  // Anführungszeichen-Escaping in customerSearchUrl() oben.
  function ilikePattern(rawQuery) {
    const cleaned = String(rawQuery == null ? "" : rawQuery).trim().replace(/[,()]/g, "");
    return cleaned ? encodeURIComponent(`*${cleaned}*`) : "";
  }

  function orFilter(columns, rawQuery) {
    const pattern = ilikePattern(rawQuery);
    if (!pattern) return "";
    return columns.map((col) => `${col}.ilike.${pattern}`).join(",");
  }

  async function searchWorkspaceTable(config, session, table, select, filterColumns, query, limit) {
    const filter = orFilter(filterColumns, query);
    if (!filter) return { ok: true, rows: [] };
    try {
      const res = await fetch(`${config.url}/rest/v1/${table}?select=${select}&or=(${filter})&limit=${limit}`, {
        method: "GET",
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${session.accessToken}`
        }
      });
      if (res.status === 401) return { ok: false, reason: "not-logged-in" };
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        return { ok: false, reason: "error", error: (errJson && errJson.message) || `HTTP ${res.status}` };
      }
      const rows = await res.json().catch(() => null);
      return { ok: true, rows: Array.isArray(rows) ? rows : [] };
    } catch (error) {
      return { ok: false, reason: "network", error: String((error && error.message) || error) };
    }
  }

  // Vier parallele Abfragen statt einer serverseitigen Volltextsuche über
  // alle Tabellen — bewusste Vereinfachung: kein Teilstring-Match auf
  // contracts.products (Array-Spalte, per ilike nicht robust abbildbar) und
  // kein totalCommission-Wert bei Kundentreffern (bräuchte einen Join über
  // alle Verträge, unverhältnismäßig für eine Schnellsuche). Kein Cache
  // (anders als fetchSharedSettings) — Ergebnisse sollen aktuell sein, der
  // Aufrufer debounced selbst.
  async function searchWorkspace(query) {
    const config = await getEffectiveSupabaseConfig();
    if (!config) return { ok: false, reason: "not-configured" };
    const session = await ensureFreshSession();
    if (!session) return { ok: false, reason: "not-logged-in" };

    const cleaned = String(query == null ? "" : query).trim().replace(/[,()]/g, "");
    if (!cleaned) return { ok: true, groups: [] };

    const [customers, contracts, tariffChanges, notes] = await Promise.all([
      searchWorkspaceTable(config, session, "customers", "customer_number,name", ["name", "customer_number"], cleaned, 6),
      searchWorkspaceTable(config, session, "contracts", "id,customer_number,customer_name,products,contract_date", ["customer_name", "customer_number", "jira_ticket"], cleaned, 5),
      searchWorkspaceTable(config, session, "tariff_changes", "id,customer_number,customer_name,change_date", ["customer_name", "customer_number", "jira_ticket"], cleaned, 5),
      searchWorkspaceTable(config, session, "notes", "id,title,content,customer_name,customer_number", ["title", "content", "customer_name"], cleaned, 5)
    ]);

    const results = [customers, contracts, tariffChanges, notes];
    // Ein abgelaufenes Login auf irgendeiner der vier Abfragen ist ein
    // eindeutiges Signal — nicht mit Teilergebnissen der anderen drei überdecken.
    if (results.some((r) => r.reason === "not-logged-in")) {
      clearSession();
      return { ok: false, reason: "not-logged-in" };
    }
    const failed = results.find((r) => !r.ok);
    if (failed) return { ok: false, reason: failed.reason || "error", error: failed.error };

    const groups = [];
    if (customers.rows.length) {
      groups.push({
        group: "Kunden",
        items: customers.rows.map((r) => ({
          kind: "customer",
          customerNumber: r.customer_number,
          label: r.name || r.customer_number,
          sub: `KdNr. ${r.customer_number}`
        }))
      });
    }
    if (contracts.rows.length) {
      groups.push({
        group: "Verträge",
        items: contracts.rows.map((r) => ({
          kind: "contract",
          customerNumber: r.customer_number,
          label: r.customer_name || r.customer_number,
          sub: `${(Array.isArray(r.products) ? r.products.join(", ") : "")} · ${r.contract_date || ""}`
        }))
      });
    }
    if (tariffChanges.rows.length) {
      groups.push({
        group: "Tarifwechsel",
        items: tariffChanges.rows.map((r) => ({
          kind: "tariff_change",
          customerNumber: r.customer_number,
          label: r.customer_name || r.customer_number,
          sub: `KdNr. ${r.customer_number} · ${r.change_date || ""}`
        }))
      });
    }
    if (notes.rows.length) {
      groups.push({
        group: "Notizen",
        items: notes.rows.map((r) => ({
          kind: "note",
          customerNumber: r.customer_number,
          label: r.title || "(ohne Titel)",
          sub: r.customer_name || (r.content || "").slice(0, 48)
        }))
      });
    }

    return { ok: true, groups };
  }

  app.supabaseClient = {
    pinToPassword,
    nameToEmail,
    parseTokenResponse,
    isSessionExpired,
    parseCustomerCardResponse,
    buildNotePayload,
    buildLeadPayload,
    buildContractPayload,
    buildTariffChangePayload,
    buildAuditLogPayload,
    buildTicketSummaryNoteFields,
    ticketSummaryNoteTitle,
    parseSharedSettingsResponse,
    loadSession,
    login,
    logout,
    ensureFreshSession,
    customerCard,
    startCall,
    endCall,
    patchCallDisposition,
    fetchCurrentShift,
    fetchUserAppearance,
    insertNote,
    upsertTicketSummaryNote,
    insertLead,
    insertContract,
    insertTariffChange,
    insertAuditLog,
    fetchSharedSettings,
    searchWorkspace
  };
})();
