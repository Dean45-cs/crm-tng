# Netz-Auskunft Bridge

Lokaler WebSocket-Server, der ein externes Frontend mit der Chrome-Extension
(Stadtnetz CRM Copilot) verbindet. Das Frontend fragt eine Netz-Auskunft
(Baustatus/FTTX oder Kündiger/Churn) zu einer Kundennummer an; die Extension
führt sie aus und streamt Fortschritt + Ergebnis zurück.

> **Kritisch.** Die Bridge erlaubt einem externen Programm, über die Extension
> interne TNG-Dashboards zu automatisieren. Sie ist **doppelt** abgesichert:
> ein Token-Handshake auf beiden Endpunkten **und** die beiden Schalter in der
> Extension (`WebSocket-Bridge …` **und** `Netz-Auskunft`, beide standardmäßig
> AUS). Nur 127.0.0.1 – nichts verlässt den Rechner.

## Start

```bash
pip install -r server/requirements.txt

BRIDGE_TOKEN="ein-langes-zufaelliges-geheimnis" \
  uvicorn server.baustatus_bridge:app --host 127.0.0.1 --port 8766
```

Ohne `BRIDGE_TOKEN` weist der Server **jede** Verbindung ab (bewusst kein
offener Standard). Ein Token erzeugen z. B. mit:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

Denselben Wert in der Extension unter **Einstellungen → Bridge-Token** eintragen
und dort **WebSocket-Bridge für externe Abfragen erlauben** sowie
**Baustatus- und Kündiger-Abfrage erlauben** aktivieren. Sobald die Extension
verbunden ist, zeigt ihr Panel das Banner „Bridge aktiv".

### Umgebungsvariablen

| Variable | Default | Zweck |
|---|---|---|
| `BRIDGE_TOKEN` | — (Pflicht) | Gemeinsames Geheimnis für den Handshake. |
| `BRIDGE_ALLOWED_ORIGINS` | leer | Optionale, kommaseparierte Origin-Allowlist für `/lookup` (zusätzliche Härtung gegen Drive-by-Verbindungen aus dem Browser). |
| `BRIDGE_LOOKUP_TIMEOUT` | `60` | Sekunden, bis eine unbeantwortete Abfrage als Zeitüberschreitung gilt. |

## Protokoll

Endpunkte (beide WebSocket, nur `127.0.0.1`):

- **`/extension`** — die Extension verbindet sich hierher. Erste Nachricht:
  `{"type":"hello","token":"…"}`. Antwort bei gültigem Token: `{"type":"ready"}`.
- **`/lookup`** — das Frontend verbindet sich hierher. Erste Nachricht:
  `{"type":"lookup","token":"…","kind":"baustatus|churn","customerNumber":"12345"}`.

Danach schickt der Server an das Frontend:

- `{"type":"status","message":"Suche läuft…"}`
- `{"type":"step","step":"…","state":"active|done","label":"…"}` (mehrfach)
- `{"type":"result","data":{…}}` **oder** `{"type":"error","message":"…"}`

Die `data` bei `result` ist das normalisierte Modell aus `shared.parseBaustatus`
bzw. `shared.parseChurn` (siehe `extension/src/shared.js`).

`GET /health` liefert `{ok, extensionConnected, tokenConfigured}` zum schnellen
Prüfen des Zustands.

## Ausprobieren

`example-client.html` im Browser öffnen (Doppelklick genügt, `file://` reicht),
Server-URL/Token/Kundennummer eintragen und **Abfragen** klicken. Läuft der
Server und ist die Extension verbunden, erscheinen die Fortschrittsschritte und
das Ergebnis live.

## Hinweis zu Freigabe/Compliance

Aktives Automatisieren interner TNG-Dashboards sollte abgestimmt sein (mit dem
Kollegen, dessen Scraper hier Pate stand, und bzgl. der Nutzungsregeln der
Dashboards). Die Schalter stehen deshalb bewusst auf AUS.
