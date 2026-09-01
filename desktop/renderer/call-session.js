"use strict";

// Die Zustandsmaschine hinter den Anrufen aus der Telefonanlage.
//
// Eigene Datei aus demselben Grund wie main/call-url.js: das hier ist die
// Stelle, an der aus einer einzelnen Meldung von außen ein Gesprächsverlauf
// wird — mit Anfang, Ende, Dauer und einer Zeile in der Anrufhistorie. Wer sie
// nur im laufenden Fenster prüfen kann, prüft sie nicht.
//
// Deshalb steht hier nichts, was ein Fenster braucht: kein chrome.storage, kein
// Supabase, kein Timer. Alles davon kommt als Rückruf herein (myapps-calls.js
// verdrahtet es), und die Uhr auch — sonst hingen die Tests an der echten Zeit.
//
// Was die Anlage liefert und was nicht, steht in myapps-calls.js. Für diese
// Datei zählen drei Eigenheiten:
//
//   1. Es gibt kein Ereignis fürs Auflegen. Ein Gespräch endet, wenn jemand im
//      Panel „Aufgelegt" drückt, wenn das nächste beginnt — oder an der
//      Sicherheitsgrenze.
//   2. Es gibt keine Richtung. Sie kommt aus der Adresse (dir=), aus dem
//      Wählen aus der Auskunft heraus, oder es bleibt bei der Voreinstellung.
//   3. Dieselbe Meldung kann mehrfach kommen. Die Conference-ID entscheidet, ob
//      das derselbe Anruf ist — nicht die Rufnummer, die bei zwei Anrufen
//      hintereinander an dieselbe Person gleich wäre.

(function initCallSession() {
  const app = (typeof globalThis !== "undefined" && globalThis.StadtnetzCRM) || null;
  if (!app) return;

  // Ein Anruf ohne Ende-Meldung darf nicht ewig als „läuft" dastehen: er würde
  // in der Live-Anrufleiste des CRM hängen bleiben. Dieselbe Grenze, ab der das
  // CRM einen offenen Anruf ohnehin nicht mehr als aktiv zählt (STALE_AFTER_MS
  // in src/components/LiveCallBar.tsx).
  const MAX_CALL_MS = 2 * 60 * 60 * 1000;

  // So lange nach dem Wählen aus der Auskunft gilt eine Anlagen-Meldung mit
  // derselben Nummer als genau dieses Gespräch. Großzügig, weil zwischen Klick
  // und Meldung das Wählen, das Klingeln und das Abheben liegen; aber nicht so
  // groß, dass ein späterer Rückruf desselben Kunden noch darauf hereinfiele.
  const PENDING_DIAL_MS = 90000;

  /**
   * @param {object} deps
   * @param {() => number} deps.now Uhr. Injiziert, damit Tests nicht warten müssen.
   * @param {(payload: object) => void} deps.publish Schreibt den activeCall-Schlüssel.
   * @param {(fields: object) => Promise<{ok: boolean, id?: string}>} [deps.startRow]
   * @param {(id: string, fields: object) => Promise<any>} [deps.endRow]
   * @param {() => ({phoneKey: string, customerNumber?: string, customerName?: string, at: number}|null)} [deps.pendingDial]
   * @param {() => void} [deps.clearPendingDial]
   * @param {() => string} [deps.defaultDirection] "inbound" | "outbound"
   * @param {(event: object) => void} [deps.onEvent] Für die Einrichtungskarte: was ist angekommen.
   */
  function createCallSession(deps) {
    const options = deps || {};
    const now = typeof options.now === "function" ? options.now : Date.now;
    const publishPayload = typeof options.publish === "function" ? options.publish : function () {};
    const startRow = typeof options.startRow === "function" ? options.startRow : null;
    const endRow = typeof options.endRow === "function" ? options.endRow : null;
    const readPendingDial = typeof options.pendingDial === "function" ? options.pendingDial : () => null;
    const clearPendingDial = typeof options.clearPendingDial === "function" ? options.clearPendingDial : function () {};
    const defaultDirection = typeof options.defaultDirection === "function"
      ? options.defaultDirection
      : () => "outbound";
    const onEvent = typeof options.onEvent === "function" ? options.onEvent : function () {};

    const shared = app.shared;

    // Der laufende Anruf. null heißt: keiner.
    let current = null;

    // --- Ableitungen aus einer Meldung ---------------------------------------

    /**
     * Die Richtung. In dieser Reihenfolge, weil so die Sicherheit abnimmt:
     * eine ausdrückliche Angabe in der Adresse steht über dem, was wir aus dem
     * eigenen Wählen wissen, und das wiederum über der bloßen Voreinstellung.
     */
    function directionOf(msg, dial) {
      const explicit = String((msg && msg.dir) || "").toLowerCase();
      if (explicit === "out" || explicit === "outbound") return { direction: "outbound", source: "anlage" };
      if (explicit === "in" || explicit === "inbound") return { direction: "inbound", source: "anlage" };
      // Aus der Auskunft heraus gewählt: dann ist es ausgehend, und zwar ohne
      // jeden Zweifel — wir haben es selbst ausgelöst.
      if (dial) return { direction: "outbound", source: "gewählt" };
      return { direction: defaultDirection() === "inbound" ? "inbound" : "outbound", source: "voreinstellung" };
    }

    /**
     * Der vorgemerkte Wählvorgang, falls er zu dieser Meldung passt. Verglichen
     * wird über den Rufnummern-Schlüssel: die Anlage meldet die Nummer im
     * internationalen Format zurück, gewählt wurde sie vielleicht national.
     */
    function matchingDial(msg) {
      const pending = readPendingDial();
      if (!pending || !pending.phoneKey) return null;
      if (now() - (pending.at || 0) > PENDING_DIAL_MS) {
        // Abgelaufen: weg damit, statt ihn liegen zu lassen. Ein Wählvorgang,
        // aus dem nie ein Gespräch wurde, ist eine gespeicherte Rufnummer ohne
        // Zweck – und Rufnummern bewahrt man nicht ohne Zweck auf.
        clearPendingDial();
        return null;
      }
      const key = shared.phoneKey((msg && msg.nr) || "");
      if (!key || key !== pending.phoneKey) return null;
      return pending;
    }

    // --- Der Zustand als Nutzlast --------------------------------------------

    function durationSeconds() {
      if (!current) return null;
      const from = current.connectedAt || current.startedAt;
      if (!from) return null;
      return Math.max(0, Math.round((now() - from) / 1000));
    }

    /** Der Storage-Schlüssel activeCall in genau der Form, die ui.js erwartet. */
    function payloadFor(status) {
      if (!current) return null;
      const payload = {
        status,
        callerName: current.name,
        callerNumber: current.number,
        customerNumber: current.customerNumber || "",
        group: "",
        updatedAt: now(),
        likelyOutbound: current.direction === "outbound",
        callId: current.callId,
        // Herkunft und Anlagen-Kennung wandern mit: das Panel kann so eine
        // Meldung der Anlage von einer timio-Meldung unterscheiden, ohne zu
        // raten — davon hängen Beschriftungen und der Rückfallweg ab.
        source: "myapps",
        externalId: current.externalId,
        // Kundenart aus dem Displaynamen (PK/GK). Nur zum Anzeigen.
        kundenart: current.kundenart || "",
        // Woher die Richtung stammt — die Einrichtungskarte zeigt es an, sonst
        // wäre eine falsche Voreinstellung von einer echten Angabe der Anlage
        // nicht zu unterscheiden.
        directionSource: current.directionSource,
        // Ein Testanruf legt keine Zeile an. Das Panel muss es wissen, sonst
        // böte es die Ergebnis-Erfassung für ein Gespräch an, das es nie gab.
        test: Boolean(current.test)
      };
      if (current.connectedAt) payload.connectedAt = current.connectedAt;
      if (status === "ended") {
        const seconds = durationSeconds();
        // Zwei Felder mit einer Aufgabe je: finalDuration ist Anzeigetext
        // (shared.callTimerText gibt ihn unverändert aus — eine nackte 37
        // stünde dort als „37" statt „0:37"), durationS die Sekundenzahl für
        // die Datenbank.
        payload.finalDuration = typeof seconds === "number" ? shared.formatDuration(seconds * 1000) : "";
        payload.durationS = seconds;
      }
      if (current.dbCallId) payload.dbCallId = current.dbCallId;
      return payload;
    }

    function publish(status) {
      const payload = payloadFor(status);
      if (payload) publishPayload(payload);
    }

    // --- Anfang und Ende -------------------------------------------------------

    function begin(msg) {
      const startedAt = now();
      const dial = matchingDial(msg);
      const direction = directionOf(msg, dial);
      // Der Displayname der Anlage trägt die Kundennummer mit sich — sofern sie
      // den Anrufer kennt. Das ist der Hauptweg zur Kundenakte; alles Weitere
      // (Rufnummernsuche, Zuordnen von Hand) ist Rückfall.
      const label = shared.parseCustomerLabel((msg && msg.name) || "");
      const ringing = String((msg && msg.ev) || "").toLowerCase() === "ring";

      current = {
        callId: `myapps-${startedAt}`,
        externalId: (msg && msg.id) || "",
        // $I (international, +49…) ist das Format, in dem Rufnummern verglichen
        // werden; main.js reicht durch, was in myApps eingetragen ist.
        number: (msg && msg.nr) || "",
        name: label.name,
        kundenart: label.kundenart,
        // Aus dem eigenen Wählen wissen wir den Kunden auch dann, wenn die
        // Anlage ihn nicht erkannt hat.
        customerNumber: label.customerNumber || (dial && dial.customerNumber) || "",
        direction: direction.direction,
        directionSource: direction.source,
        startedAt,
        // Beim Klingeln läuft noch keine Gesprächsdauer.
        connectedAt: ringing ? null : startedAt,
        status: ringing ? "ringing" : "connected",
        test: Boolean(msg && msg.test),
        dbCallId: null,
        rowPending: false,
        // Ob für DIESES Gespräch je ein Medien-Socket gesehen wurde. Die
        // Sicherung, auf der die ganze Ende-Erkennung steht — siehe
        // mediaState().
        sawMedia: false,
        // Ob während dieses Gesprächs überhaupt gemessen wurde. Der Unterschied
        // zu sawMedia ist der zwischen „hat nicht abgenommen" und „ich habe
        // nicht hingesehen" — und er entscheidet, ob dieser Anruf in der
        // Erreichbarkeitsquote mitzählen darf.
        mediaWorked: false,
        // Wann tatsächlich abgehoben wurde, beobachtet statt angenommen.
        // startedAt ist das Klingeln; das hier ist das Gespräch.
        connectedObservedAt: null
      };

      if (dial) clearPendingDial();
      publish(current.status);
      record();
      onEvent({
        type: "call",
        at: startedAt,
        test: current.test,
        recognized: Boolean(label.customerNumber),
        hasName: Boolean(label.name),
        externalId: current.externalId
      });
      return current;
    }

    /** Legt die Zeile in `calls` an – derselbe Aufruf wie aus timio heraus. */
    function record() {
      if (!startRow || !current || current.test || current.rowPending) return;
      const forCallId = current.callId;
      current.rowPending = true;

      Promise.resolve()
        .then(() => startRow({
          customerNumber: current && current.customerNumber ? current.customerNumber : undefined,
          callerName: current && current.name ? current.name : undefined,
          callerNumber: current && current.number ? current.number : undefined,
          direction: current ? current.direction : "outbound",
          // Die Conference-ID der Anlage. Ohne sie liefe jeder wiederholte
          // Aufruf für dasselbe Gespräch auf eine zweite Zeile hinaus.
          externalId: current && current.externalId ? current.externalId : undefined
        }))
        .then((res) => {
          if (!res || !res.ok || !res.id) return;
          // Inzwischen ein anderer Anruf: die Zeile gehört trotzdem
          // geschlossen, sonst bliebe sie für immer ohne ended_at stehen.
          if (!current || current.callId !== forCallId) {
            if (endRow) Promise.resolve(endRow(res.id, { endedAt: new Date(now()).toISOString(), durationS: null })).catch(() => {});
            return;
          }
          current.rowPending = false;
          current.dbCallId = res.id;
          // Die Zeilen-ID muss ins Panel: nur damit kann das Gesprächsergebnis
          // später auf denselben Datensatz geschrieben werden.
          publish(current.status);
        })
        .catch(() => {
          if (current && current.callId === forCallId) current.rowPending = false;
        });
    }

    /**
     * Schließt die Zeile in `calls` und räumt auf. Getrennt vom Melden des
     * Endes, weil dieses auf zwei Wegen kommt: von hier (neuer Anruf,
     * Sicherheitsgrenze, ev=end) — dann muss der Statuswechsel noch geschrieben
     * werden — oder vom Panel, wenn jemand „Aufgelegt" drückt. Dann steht er
     * schon im Storage, und ein zweites Schreiben wäre nur Lärm.
     */
    function closeRow(durationS, reason) {
      if (!current) return;
      const ending = current;
      current = null;

      if (endRow && ending.dbCallId && !ending.test) {
        Promise.resolve(endRow(ending.dbCallId, {
          endedAt: new Date(now()).toISOString(),
          durationS: typeof durationS === "number" ? durationS : null,
          // Der beobachtete Verbindungszeitpunkt. Nur wenn er auch beobachtet
          // wurde — geraten wird hier nichts, sonst stünde eine erfundene
          // Gesprächsdauer in der Auswertung.
          connectedAt: ending.connectedObservedAt
            ? new Date(ending.connectedObservedAt).toISOString()
            : null,
          // Dreiwertig, und das ist der ganze Punkt (siehe Migration 028):
          // true = abgehoben, false = sicher nicht abgehoben, null = nicht
          // gemessen. Ohne das dritte „weiß nicht" fiele jede
          // Erreichbarkeitsquote genau in dem Maß zu schlecht aus, wie die
          // Erkennung ausfällt.
          answered: ending.sawMedia ? true : (ending.mediaWorked ? false : null),
          endReason: reason || ""
        })).catch(() => {});
      }
      return ending;
    }

    /**
     * Ende von hier aus: melden und schließen.
     *
     * Der Grund geht als Ereignis an die Einrichtungskarte, nicht in die
     * Anrufhistorie — dort zählt die Dauer, nicht wie wir sie erfahren haben.
     * Sichtbar sein muss er trotzdem: eine Erkennung, die sich bei Unklarheit
     * still selbst abschaltet, ist sonst nicht von einer kaputten zu
     * unterscheiden.
     */
    function finish(reason) {
      if (!current) return null;
      const seconds = durationSeconds();
      const why = reason || "von-hand";
      const sawMedia = current.sawMedia;
      publish("ended");
      const ending = closeRow(seconds, why);
      onEvent({ type: "call-end", at: now(), reason: why, sawMedia, durationS: seconds });
      return ending;
    }

    /** Zu lange offen – siehe MAX_CALL_MS. */
    function expireIfStale() {
      if (!current || !current.startedAt) return false;
      if (now() - current.startedAt < MAX_CALL_MS) return false;
      finish("grenze");
      return true;
    }

    // --- Was von außen hereinkommt ---------------------------------------------

    /** Eine Meldung der Anlage (siehe main/call-url.js). */
    function report(msg) {
      if (!msg) return null;
      expireIfStale();

      if (String(msg.ev || "").toLowerCase() === "end") {
        finish("anlage");
        return null;
      }

      // Derselbe Anruf noch einmal: nur auffrischen, was inzwischen
      // dazugekommen ist – auf keinen Fall eine zweite Zeile anlegen.
      if (current && msg.id && current.externalId && current.externalId === msg.id) {
        if (msg.nr) current.number = msg.nr;
        if (msg.name) {
          const label = shared.parseCustomerLabel(msg.name);
          if (label.name) current.name = label.name;
          if (label.kundenart) current.kundenart = label.kundenart;
          if (label.customerNumber && !current.customerNumber) current.customerNumber = label.customerNumber;
        }
        // Eine zweite Meldung zu einem klingelnden Anruf ist das Abheben — der
        // einzige Zeitpunkt, an dem ein „klingelt" verlässlich zu einem
        // Gespräch wird. Ohne das bliebe ein mit ev=ring gemeldeter Anruf für
        // immer am Klingeln, und die Dauer begänne nie.
        if (current.status === "ringing" && String(msg.ev || "").toLowerCase() !== "ring") {
          current.status = "connected";
          current.connectedAt = now();
        }
        publish(current.status);
        return current;
      }

      // Ein neuer Anruf beendet den vorherigen. Ohne Ende-Meldung von der
      // Anlage ist das der einzige verlässliche Zeitpunkt, an dem feststeht,
      // dass das vorige Gespräch vorbei ist.
      if (current) finish("naechster-anruf");
      return begin(msg);
    }

    /**
     * Der Herzschlag. Er frischt nur die Frische auf: das Panel hält einen
     * Anruf für verwaist, wenn sein Eintrag älter als CONFIG.call.staleAfterMs
     * ist. Der Status wird dabei UNVERÄNDERT wiederholt — ein Herzschlag, der
     * „connected" schreibt, machte aus jedem klingelnden Anruf nach wenigen
     * Sekunden ein laufendes Gespräch, ohne dass irgendwo ein Fehler aufliefe.
     */
    function heartbeat() {
      if (!current) return false;
      if (expireIfStale()) return false;
      publish(current.status);
      return true;
    }

    /**
     * Das Panel hat „Aufgelegt" gedrückt. Der Statuswechsel steht damit schon
     * im Storage; hier bleibt, die Zeile in der Historie zu schließen. Ohne das
     * schriebe der Herzschlag den Anruf im nächsten Takt wieder auf „läuft",
     * und das Gespräch ließe sich gar nicht beenden.
     */
    function endedByPanel(payload) {
      if (!current || !payload) return null;
      if (payload.callId && payload.callId !== current.callId) return null;
      const seconds = typeof payload.durationS === "number" ? payload.durationS : durationSeconds();
      const sawMedia = current.sawMedia;
      const ending = closeRow(seconds, "von-hand");
      onEvent({ type: "call-end", at: now(), reason: "von-hand", sawMedia, durationS: seconds });
      return ending;
    }

    /**
     * Das Panel hat dem Anruf einen Kunden zugeordnet (Rufnummernsuche oder von
     * Hand). Ohne Übernahme in den eigenen Zustand putzte der nächste
     * Herzschlag die Zuordnung nach vier Sekunden wieder weg — der Fehler wäre
     * unsichtbar: es stünde nur wieder „unbekannt" da.
     */
    function assignCustomer(payload) {
      if (!current || !payload) return null;
      if (payload.callId && payload.callId !== current.callId) return null;
      const number = String(payload.customerNumber || "").trim();
      if (!number || number === current.customerNumber) return null;
      current.customerNumber = number;
      if (payload.customerName) current.name = payload.customerName;
      publish(current.status);
      return current;
    }

    /**
     * Was am Medien-Socket von myApps beobachtet wurde (main/media-watch.js).
     *
     * DIE SICHERUNG: beendet wird ein Gespräch nur, wenn für genau dieses
     * Gespräch vorher Medien gesehen wurden. Ein Anruf endet nie daran, dass
     * etwas FEHLT — nur daran, dass etwas Dagewesenes verschwindet.
     *
     * Der Unterschied ist der zwischen „aufgelegt" und „ich kann nicht
     * hinsehen". Auf einem Rechner, auf dem die Beobachtung nicht greift (andere
     * Plattform, andere myApps-Fassung, lsof fehlt), kommt nie ein „media" an —
     * und damit beendet sie auch nie etwas. Der Rückfall ist dann genau das
     * Verhalten von vorher: „Aufgelegt", der nächste Anruf, die Sicherheitsgrenze.
     *
     * Deshalb ist „unknown" hier ausdrücklich kein Ende. Eine misslungene
     * Messung ist kein Auflegen.
     *
     * @returns das beendete Gespräch — und NUR dann etwas. Alles andere ist
     *          null, auch das Erkennen der Medien.
     */
    function mediaState(state) {
      if (!current) return null;

      // DER RÜCKGABEWERT IST EIN VERSPRECHEN: „hier ist das beendete Gespräch"
      // — nichts anderes. Er hat einmal beim Auftauchen der Medien `current`
      // zurückgegeben, und die Verdrahtung las das als Ende: sie stellte den
      // Herzschlag genau dann ab, wenn das Gespräch gerade erst begann. Danach
      // frischte niemand mehr `activeCall` auf, und das Panel hielt den Anruf
      // nach staleAfterMs (15 s) für verwaist — ein laufendes Gespräch endete
      // nach rund zwanzig Sekunden von selbst, ohne Fehlermeldung.
      // Jede eindeutige Messung — auch eine, die nichts findet — beweist, dass
      // die Erkennung auf diesem Rechner arbeitet. Nur „unknown" beweist nichts.
      if (state === "media" || state === "idle") current.mediaWorked = true;

      if (state === "media") {
        current.sawMedia = true;
        // Der erste Medien-Socket IST das Abheben. Bei einem eingehenden Anruf
        // liegt zwischen startedAt und hier die Klingelzeit; sie gehört nicht
        // in die Gesprächsdauer.
        if (!current.connectedObservedAt) {
          current.connectedObservedAt = now();
          if (current.status === "ringing") {
            current.status = "connected";
            current.connectedAt = current.connectedObservedAt;
            publish(current.status);
          }
        }
        return null;
      }
      if (state !== "idle" || !current.sawMedia) return null;
      return finish("aufgelegt-erkannt");
    }

    /**
     * Von außen unterbrochen: gesperrter Bildschirm, Ruhezustand, myApps
     * beendet. Anders als der Medien-Socket braucht das keinen Beweis — dort
     * spricht niemand mehr, egal was vorher beobachtet wurde.
     */
    function interrupted(reason) {
      if (!current) return null;
      return finish(reason || "unterbrochen");
    }

    function snapshot() {
      if (!current) return null;
      return {
        callId: current.callId,
        externalId: current.externalId,
        number: current.number,
        name: current.name,
        kundenart: current.kundenart,
        customerNumber: current.customerNumber,
        direction: current.direction,
        directionSource: current.directionSource,
        status: current.status,
        startedAt: current.startedAt,
        connectedAt: current.connectedAt,
        test: current.test,
        dbCallId: current.dbCallId,
        sawMedia: current.sawMedia,
        mediaWorked: current.mediaWorked,
        connectedObservedAt: current.connectedObservedAt
      };
    }

    return {
      report, heartbeat, endedByPanel, assignCustomer, finish, mediaState, interrupted,
      snapshot, MAX_CALL_MS, PENDING_DIAL_MS
    };
  }

  app.createCallSession = createCallSession;
})();
