import threading
import time
import platform
import ctypes

from protocol import (
    HEARTBEAT_TIMEOUT_SECONDS, 
    WATCHDOG_POLL_INTERVAL_SECONDS, 
    AUTO_LOCK_TIMEOUT_SECONDS
)

def lock_workstation():
    """Native OS command to lock Windows (Equivalent to Win + L)"""
    if platform.system() == "Windows":
        try:
            ctypes.windll.user32.LockWorkStation()
            print("[Watchdog] 🔒 System Locked Successfully (Win + L executed).")
        except Exception as e:
            print(f"[Watchdog] Lock command failed: {e}")

def start_watchdog(hud, state_tracker: dict):
    def _loop():
        while True:
            time.sleep(WATCHDOG_POLL_INTERVAL_SECONDS)
            now = time.time()

            # 1. Network Dead-Man Switch
            if hud.is_visible and (now - state_tracker["last_ping"] > HEARTBEAT_TIMEOUT_SECONDS):
                print("[Watchdog] No heartbeat -> force-restoring workspace")
                hud.trigger_hide()

            # 2. Desk Abandonment Auto-Lock (5 Min Timer)
            if state_tracker.get("is_away", False):
                away_since = state_tracker.get("away_since")
                if away_since and (now - away_since >= AUTO_LOCK_TIMEOUT_SECONDS):
                    print(f"[Watchdog] ⏱️ Operator absent for {AUTO_LOCK_TIMEOUT_SECONDS}s. Locking System...")
                    lock_workstation()
                    
                    # Reset tracker to avoid spamming the lock command
                    state_tracker["is_away"] = False
                    state_tracker["away_since"] = None

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    return thread