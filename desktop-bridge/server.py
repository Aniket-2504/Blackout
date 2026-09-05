"""
FastAPI entrypoint. Wires the HUD thread, the watchdog thread, and the
WebSocket endpoint together. All the actual logic lives in hud.py and
watchdog.py — this file is just composition.
"""

import threading
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

from hud import ThreadSafePrivacyHUD
from watchdog import start_watchdog
from protocol import (
    EVENT_PING,
    THREAT_EVENTS,
    CLEAR_EVENTS,
    IncomingMessage,
)

app = FastAPI()

hud = ThreadSafePrivacyHUD()
threading.Thread(target=hud.start_gui, daemon=True).start()

last_heartbeat = {"t": time.time()}
start_watchdog(hud, last_heartbeat)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[Bridge] 🟢 Device connected on port 8000")
    last_heartbeat["t"] = time.time()
    try:
        while True:
            raw = await websocket.receive_json()
            try:
                msg = IncomingMessage(**raw)
            except Exception as e:
                print(f"[Bridge] Bad payload ignored: {e}")
                continue

            last_heartbeat["t"] = time.time()  # any valid traffic counts as alive

            if msg.event == EVENT_PING:
                continue
            elif msg.event in THREAT_EVENTS:
                hud.trigger_show(msg.reason)
            elif msg.event in CLEAR_EVENTS:
                hud.trigger_hide()

    except WebSocketDisconnect:
        print("[Bridge] 🔴 Device disconnected -> Auto-restoring workspace")
        hud.trigger_hide()
    except Exception as e:
        print(f"[Bridge Error]: {e}")
        hud.trigger_hide()


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)