"""
TNG Netz-Auskunft Bridge — gehärtete Fassung.

Vermittelt zwischen einem externen Frontend und der Chrome-Extension
(Stadtnetz CRM Copilot). Das Frontend fragt über /lookup eine Netz-Auskunft
(Baustatus oder Churn) zu einer Kundennummer an; die Extension, die über
/extension verbunden ist, führt sie aus und streamt Fortschritt + Ergebnis
zurück.

Sicherheit (bewusst strenger als die ursprüngliche Vorlage):
  - Token-Handshake auf BEIDEN Endpunkten. Ohne BRIDGE_TOKEN läuft nichts:
    Ist die Variable nicht gesetzt, werden alle Verbindungen abgewiesen.
  - Nur 127.0.0.1 (siehe --host im Start-Kommando unten). Nichts verlässt den
    Rechner.
  - Optionaler Origin-Allowlist-Check (BRIDGE_ALLOWED_ORIGINS) für /lookup, um
    Drive-by-Verbindungen aus dem Browser zusätzlich einzugrenzen.
  - Genau ein Extension-Slot; ein zweiter Verbinder verdrängt den ersten nicht
    stillschweigend, sondern wird abgewiesen.

Start (Token PFLICHT):
  pip install -r server/requirements.txt
  BRIDGE_TOKEN="ein-langes-zufaelliges-geheimnis" \
    uvicorn server.baustatus_bridge:app --host 127.0.0.1 --port 8766

Dasselbe Token muss in der Extension unter Einstellungen → „Bridge-Token"
stehen, und die Extension muss „WebSocket-Bridge …" aktiviert haben.
"""

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("netzauskunft-bridge")

TOKEN = os.environ.get("BRIDGE_TOKEN", "").strip()
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("BRIDGE_ALLOWED_ORIGINS", "").split(",") if o.strip()]
LOOKUP_TIMEOUT_S = float(os.environ.get("BRIDGE_LOOKUP_TIMEOUT", "60"))
VALID_KINDS = {"baustatus", "churn"}

if not TOKEN:
    log.warning("BRIDGE_TOKEN ist NICHT gesetzt — alle Verbindungen werden abgewiesen. "
                "Server mit BRIDGE_TOKEN=… starten.")

app = FastAPI(title="TNG Netz-Auskunft Bridge")

# CORS betrifft nur HTTP; WebSockets werden separat über das Token (und optional
# Origin) abgesichert. Die Allowlist bleibt hier bewusst eng.
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS or ["http://localhost", "http://127.0.0.1"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

# ── Zustand ──────────────────────────────────────────────────────────────────

extension_ws: Optional[WebSocket] = None          # genau eine Extension-Verbindung
pending: dict = {}                                 # requestId → asyncio.Future(Ergebnis)
customer_connections: dict = {}                    # requestId → Kunden-WS (für Step-Forwarding)


def origin_allowed(ws: WebSocket) -> bool:
    if not ALLOWED_ORIGINS:
        return True  # keine Allowlist konfiguriert → nur Token schützt
    origin = ws.headers.get("origin")
    return origin in ALLOWED_ORIGINS


async def reject(ws: WebSocket, message: str) -> None:
    try:
        await ws.send_text(json.dumps({"type": "error", "message": message}))
    except Exception:
        pass
    try:
        await ws.close()
    except Exception:
        pass


# ── Extension-Endpunkt ───────────────────────────────────────────────────────

@app.websocket("/extension")
async def extension_endpoint(ws: WebSocket):
    global extension_ws
    await ws.accept()

    try:
        hello = json.loads(await ws.receive_text())
    except Exception:
        await reject(ws, "Ungültiger Handshake.")
        return

    if not TOKEN or hello.get("type") != "hello" or hello.get("token") != TOKEN:
        await reject(ws, "Ungültiges oder fehlendes Token.")
        return

    if extension_ws is not None:
        # Es gibt schon eine Extension-Verbindung – die neue wird abgewiesen,
        # statt die bestehende stillschweigend zu verdrängen.
        await reject(ws, "Es ist bereits eine Extension verbunden.")
        return

    extension_ws = ws
    await ws.send_text(json.dumps({"type": "ready"}))
    log.info("Extension verbunden")

    try:
        while True:
            msg = json.loads(await ws.receive_text())
            req_id = msg.get("requestId")
            mtype = msg.get("type")

            if mtype == "result" and req_id in pending and not pending[req_id].done():
                pending[req_id].set_result(msg.get("data"))
            elif mtype == "error" and req_id in pending and not pending[req_id].done():
                pending[req_id].set_exception(LookupError(msg.get("message") or "Abfrage fehlgeschlagen."))
            elif mtype == "step" and req_id in customer_connections:
                cws = customer_connections.get(req_id)
                if cws is not None:
                    try:
                        await cws.send_text(json.dumps({
                            "type": "step",
                            "step": msg.get("step"),
                            "state": msg.get("state"),
                            "label": msg.get("label", ""),
                        }))
                    except Exception:
                        pass
    except WebSocketDisconnect:
        log.info("Extension getrennt")
    finally:
        if extension_ws is ws:
            extension_ws = None


# ── Kunden-/Frontend-Endpunkt ────────────────────────────────────────────────

@app.websocket("/lookup")
async def lookup_endpoint(ws: WebSocket):
    await ws.accept()
    req_id = str(uuid.uuid4())

    if not origin_allowed(ws):
        await reject(ws, "Origin nicht erlaubt.")
        return

    try:
        msg = json.loads(await ws.receive_text())
    except Exception:
        await reject(ws, "Ungültige Anfrage.")
        return

    if not TOKEN or msg.get("token") != TOKEN:
        await reject(ws, "Ungültiges oder fehlendes Token.")
        return
    if msg.get("type") != "lookup":
        await reject(ws, "Ungültige Anfrage.")
        return

    kind = (msg.get("kind") or "baustatus").strip()
    customer_nr = str(msg.get("customerNumber") or msg.get("kundenNr") or "").strip()
    if kind not in VALID_KINDS:
        await reject(ws, "Unbekannte Abfrageart.")
        return
    if not customer_nr:
        await reject(ws, "Kundennummer erforderlich.")
        return
    if extension_ws is None:
        await reject(ws, "Extension nicht verbunden. Bitte die TNG-Extension in Chrome öffnen und die Bridge aktivieren.")
        return

    customer_connections[req_id] = ws
    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    pending[req_id] = fut

    try:
        await extension_ws.send_text(json.dumps({
            "type": "lookup",
            "requestId": req_id,
            "kind": kind,
            "customerNumber": customer_nr,
        }))
        await ws.send_text(json.dumps({"type": "status", "message": "Suche läuft…"}))

        data = await asyncio.wait_for(fut, timeout=LOOKUP_TIMEOUT_S)
        await ws.send_text(json.dumps({"type": "result", "data": data}))
    except asyncio.TimeoutError:
        await ws.send_text(json.dumps({"type": "error", "message": "Zeitüberschreitung bei der Abfrage."}))
    except LookupError as exc:
        await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # noqa: BLE001 — Frontend soll eine klare Meldung bekommen
        try:
            await ws.send_text(json.dumps({"type": "error", "message": f"Serverfehler: {exc}"}))
        except Exception:
            pass
    finally:
        pending.pop(req_id, None)
        customer_connections.pop(req_id, None)
        try:
            await ws.close()
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"ok": True, "extensionConnected": extension_ws is not None, "tokenConfigured": bool(TOKEN)}
