(function initAiCache() {
  "use strict";

  const app = window.StadtnetzCRM;
  const CONFIG = app.CONFIG;
  const MAX_TICKETS = (CONFIG.aiCache && CONFIG.aiCache.maxTickets) || 30;

  let cache = { entries: {} };

  // FNV-1a (32-bit). Kein kryptografischer Hash nötig – dient nur dazu,
  // zu erkennen, ob sich der Ticketinhalt seit der letzten KI-Generierung
  // geändert hat.
  function fnv1a32(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  // Bewusst ohne priority/assignee/customerName/summary: administrative
  // Änderungen sollen eine gecachte Karte nicht fälschlich veraltet erscheinen lassen.
  function fingerprint(ticket) {
    if (!ticket) return "";
    const basis = [
      ticket.status,
      ticket.commentCount,
      ticket.description,
      (Array.isArray(ticket.comments) ? ticket.comments : []).join("␟")
    ].join("␞");
    return fnv1a32(basis);
  }

  function init(rawStoredValue) {
    if (rawStoredValue && typeof rawStoredValue === "object" && rawStoredValue.entries && typeof rawStoredValue.entries === "object") {
      cache = rawStoredValue;
    } else {
      cache = { entries: {} };
    }
  }

  function persist() {
    // Guard gegen "Extension context invalidated" nach einem Reload der
    // Extension: die alte Script-Instanz schreibt dann einfach nicht mehr.
    try {
      if (chrome.runtime && chrome.runtime.id && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [CONFIG.storageKeys.aiCache]: cache });
      }
    } catch (error) { /* alte Instanz – ignorieren */ }
  }

  function evictIfNeeded() {
    const keys = Object.keys(cache.entries);
    if (keys.length <= MAX_TICKETS) return;
    keys
      .sort((a, b) => (cache.entries[a].lastAccessedAt || 0) - (cache.entries[b].lastAccessedAt || 0))
      .slice(0, keys.length - MAX_TICKETS)
      .forEach((key) => { delete cache.entries[key]; });
  }

  function getEntry(ticketKey) {
    const entry = cache.entries[ticketKey];
    if (!entry) return null;
    entry.lastAccessedAt = Date.now();
    persist();
    return entry;
  }

  function saveField(ticketKey, fieldName, value) {
    if (!ticketKey) return;
    const entry = cache.entries[ticketKey] || { lastAccessedAt: Date.now() };
    entry[fieldName] = value;
    entry.lastAccessedAt = Date.now();
    cache.entries[ticketKey] = entry;
    evictIfNeeded();
    persist();
  }

  app.aiCache = { init, fingerprint, getEntry, saveField };
})();
