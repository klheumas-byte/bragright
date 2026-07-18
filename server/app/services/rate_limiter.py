import hashlib
import threading
import time
from collections import defaultdict, deque


class FixedWindowRateLimiter:
    """Small, dependency-free limiter for abuse-sensitive routes.

    State is intentionally bounded and contains only hashed client identifiers.
    For horizontally scaled deployments, replace this backend with a shared store.
    """

    def __init__(self):
        self._events = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, scope, identity, *, limit, window_seconds=60):
        now = time.monotonic()
        cutoff = now - window_seconds
        identity_hash = hashlib.sha256(
            str(identity or "unknown").encode("utf-8")
        ).hexdigest()
        key = (scope, identity_hash)

        with self._lock:
            events = self._events[key]
            while events and events[0] <= cutoff:
                events.popleft()

            if len(events) >= limit:
                retry_after = max(1, int(window_seconds - (now - events[0])) + 1)
                return False, retry_after

            events.append(now)

            # Opportunistic cleanup prevents unbounded growth from one-off clients.
            if len(self._events) > 10_000:
                stale_keys = [
                    event_key
                    for event_key, values in self._events.items()
                    if not values or values[-1] <= cutoff
                ]
                for stale_key in stale_keys:
                    self._events.pop(stale_key, None)

        return True, 0
