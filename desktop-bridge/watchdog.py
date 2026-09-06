"""
Dead-man's-switch. If the phone stops sending any traffic (crash, killed
process, Wi-Fi dropped without a clean WebSocket close), this forces the
HUD to hide after HEARTBEAT_TIMEOUT_SECONDS instead of leaving the
laptop dimmed/locked forever. Judges toggling Wi-Fi off mid-demo is
exactly the case this exists for.
"""

import threading
import time

from protocol import HEARTBEAT_TIMEOUT_SECONDS, WATCHDOG_POLL_INTERVAL_SECONDS


def start_watchdog(hud, last_heartbeat: dict):
    def _loop():
        while True:
            time.sleep(WATCHDOG_POLL_INTERVAL_SECONDS)
            if hud.is_visible and (time.time() - last_heartbeat["t"] > HEARTBEAT_TIMEOUT_SECONDS):
                print("[Watchdog] No heartbeat -> force-restoring workspace")
                hud.trigger_hide()

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread