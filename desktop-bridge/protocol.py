from typing import Optional
from pydantic import BaseModel

# ---- Inbound event types (phone -> laptop) ----
EVENT_PING = "PING"
EVENT_BLUR = "BLUR"
EVENT_LOCKDOWN = "LOCKDOWN"
EVENT_RESTORE = "RESTORE"
EVENT_SAFE = "SAFE"
EVENT_AWAY = "AWAY"  

THREAT_EVENTS = {EVENT_BLUR, EVENT_LOCKDOWN}
CLEAR_EVENTS = {EVENT_RESTORE, EVENT_SAFE}
AWAY_EVENTS = {EVENT_AWAY}

# ---- Heartbeat / watchdog tuning ----
HEARTBEAT_TIMEOUT_SECONDS = 3.0
WATCHDOG_POLL_INTERVAL_SECONDS = 0.5
AUTO_LOCK_TIMEOUT_SECONDS =4.0


class IncomingMessage(BaseModel):
    """Validates whatever JSON arrives over the socket."""
    event: str
    reason: Optional[str] = "Secondary Observer Detected"
    timestamp: Optional[int] = None