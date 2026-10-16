"""Process-local safeguards for a single-instance free demo."""
from collections import deque, OrderedDict
from datetime import datetime, timezone
from threading import Lock
import time
from src.config import MAX_SESSIONS, REQUESTS_PER_MINUTE, DAILY_CHARACTERS, SESSION_SECONDS, SESSION_CHARACTERS


class DemoLimit(Exception):
    pass


class DemoLimits:
    def __init__(self):
        self._lock = Lock()
        self.active = 0
        self.requests = deque()
        self.visitors = OrderedDict()
        self.day = ''
        self.characters = 0

    def acquire(self, visitor: str):
        now = time.monotonic()
        with self._lock:
            if self.active >= MAX_SESSIONS:
                raise DemoLimit('The demo is at capacity. Please try again shortly.')
            history = self.visitors.setdefault(visitor, deque())
            while history and history[0] < now - 900:
                history.popleft()
            if len(history) >= 6:
                raise DemoLimit('Please wait a few minutes before starting another session.')
            history.append(now)
            self.visitors.move_to_end(visitor)
            if len(self.visitors) > 1024:
                self.visitors.popitem(last=False)
            self.active += 1

    def release(self):
        with self._lock:
            self.active -= 1

    def reserve_request(self):
        now = time.monotonic()
        with self._lock:
            while self.requests and self.requests[0] <= now - 60:
                self.requests.popleft()
            if len(self.requests) >= REQUESTS_PER_MINUTE:
                raise DemoLimit('Translation requests are temporarily paused. Please retry in one minute.')
            self.requests.append(now)

    def reserve_characters(self, count: int):
        day = datetime.now(timezone.utc).date().isoformat()
        with self._lock:
            if day != self.day:
                self.day, self.characters = day, 0
            if self.characters + count > DAILY_CHARACTERS:
                raise DemoLimit('Today’s demo voice allowance is used up. Please return tomorrow.')
            self.characters += count

    def snapshot(self):
        with self._lock:
            today = datetime.now(timezone.utc).date().isoformat()
            return {'active_sessions': self.active, 'max_sessions': MAX_SESSIONS,
                    'requests_last_minute': sum(t > time.monotonic()-60 for t in self.requests),
                    'requests_per_minute_limit': REQUESTS_PER_MINUTE,
                    'daily_characters_used': self.characters if self.day == today else 0,
                    'daily_character_limit': DAILY_CHARACTERS,
                    'session_seconds': SESSION_SECONDS, 'session_characters': SESSION_CHARACTERS}
