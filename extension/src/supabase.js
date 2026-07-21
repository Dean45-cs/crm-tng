(function initSupportCopilotSupabase() {
  "use strict";

  // globalThis statt window: identisch im Content-Script, siehe config.js/shared.js.
  globalThis.SupportCopilot = globalThis.SupportCopilot || {};
  const app = globalThis.SupportCopilot;
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

  async function ensureFreshSession() {
    const session = await loadSession();
    if (!session) return null;
    if (!isSessionExpired(session)) return session;
    return refreshSession(session);
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

  app.supabaseClient = {
    pinToPassword,
    nameToEmail,
    parseTokenResponse,
    isSessionExpired,
    parseCustomerCardResponse,
    loadSession,
    login,
    logout,
    ensureFreshSession,
    customerCard,
    startCall,
    endCall
  };
})();
