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
    EVENT_AWAY,
    IncomingMessage,
)

app = FastAPI()

hud = ThreadSafePrivacyHUD()
threading.Thread(target=hud.start_gui, daemon=True).start()

# Track network AND physical presence
state_tracker = {
    "last_ping": time.time(),
    "is_away": False,
    "away_since": None
}
start_watchdog(hud, state_tracker)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("[Bridge] 🟢 Device connected on port 8000")
    state_tracker["last_ping"] = time.time()
    
    try:
        while True:
            raw = await websocket.receive_json()
            try:
                msg = IncomingMessage(**raw)
            except Exception as e:
                print(f"[Bridge] Bad payload ignored: {e}")
                continue

            state_tracker["last_ping"] = time.time()

            if msg.event == EVENT_PING:
                continue
            
            elif msg.event in THREAT_EVENTS:
                hud.trigger_show(msg.reason)
                state_tracker["is_away"] = False
                state_tracker["away_since"] = None
                
            elif msg.event in CLEAR_EVENTS:
                hud.trigger_hide()
                if state_tracker["is_away"]:
                    print("[Bridge] 🟢 Operator Returned. Auto-Lock Cancelled.")
                state_tracker["is_away"] = False
                state_tracker["away_since"] = None
                
            elif msg.event == EVENT_AWAY:
                hud.trigger_hide()
                if not state_tracker["is_away"]:
                    state_tracker["is_away"] = True
                    state_tracker["away_since"] = time.time()
                    print("[Bridge] ⚠️ Operator Away. 4-second Auto-Lock timer started.")

    except WebSocketDisconnect:
        print("[Bridge] 🔴 Device disconnected -> Auto-restoring workspace")
        hud.trigger_hide()
    except Exception as e:
        print(f"[Bridge Error]: {e}")
        hud.trigger_hide()

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
