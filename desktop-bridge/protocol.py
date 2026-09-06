"""
Shared message contract between the phone (WebSocket client) and the
laptop bridge. Keeping these as named constants instead of raw strings
scattered across hud.py/watchdog.py/server.py means a typo becomes an
import error instead of a silent no-op at runtime.
"""

from typing import Optional
from pydantic import BaseModel

# ---- Inbound event types (phone -> laptop) ----
EVENT_PING = "PING"
EVENT_BLUR = "BLUR"
EVENT_LOCKDOWN = "LOCKDOWN"
EVENT_RESTORE = "RESTORE"
EVENT_SAFE = "SAFE"

THREAT_EVENTS = {EVENT_BLUR, EVENT_LOCKDOWN}
CLEAR_EVENTS = {EVENT_RESTORE, EVENT_SAFE}

# ---- Heartbeat / watchdog tuning ----
HEARTBEAT_TIMEOUT_SECONDS = 3.0
WATCHDOG_POLL_INTERVAL_SECONDS = 0.5


class IncomingMessage(BaseModel):
    """Validates whatever JSON arrives over the socket. Bad/missing
    fields fail fast with a clear error instead of a KeyError three
    frames deep in the HUD thread."""
    event: str
    reason: Optional[str] = "Secondary Observer Detected"
    timestamp: Optional[int] = None