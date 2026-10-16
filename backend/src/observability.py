"""Bounded process-local operational measurements. Never stores user content."""
from collections import Counter, deque
from datetime import datetime, timezone
import json
import logging
import math
import time
from statistics import median

logger = logging.getLogger('voice-translator.events')
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter('%(message)s'))
    logger.addHandler(handler)
logger.propagate = False


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def event_log(event, **fields):
    logger.info(json.dumps({'event': event, 'at': timestamp(), **fields}, ensure_ascii=True))


class Monitor:
    def __init__(self):
        self.started = time.monotonic()
        self.started_at = timestamp()
        self.counts = Counter()
        self.samples = {}
        self.providers = {stage: {'successes': 0, 'failures': 0, 'last_success': None,
                                 'last_error': None, 'last_error_category': None,
                                 'last_status_code': None} for stage in ['stt', 'translation', 'tts']}
        self.errors = deque(maxlen=20)

    def increment(self, name):
        self.counts[name] += 1

    def observe(self, name, milliseconds):
        if isinstance(milliseconds, (float, int)) and math.isfinite(milliseconds) and 0 <= milliseconds <= 300_000:
            self.samples.setdefault(name, deque(maxlen=120)).append(round(milliseconds, 2))

    def stage_success(self, stage, milliseconds):
        provider = self.providers['tts' if stage == 'tts_first_byte' else stage]
        provider['successes'] += 1
        provider['last_success'] = timestamp()
        self.observe(stage + '_ms', milliseconds)

    def stage_error(self, stage, exc):
        code = getattr(exc, 'status_code', None)
        category = ('quota' if code == 429 else 'authentication' if code in (401, 403)
                    else 'unavailable' if code in (402, 404) else 'timeout' if 'timeout' in type(exc).__name__.lower()
                    else 'upstream')
        at = timestamp()
        if stage in self.providers:
            self.providers[stage].update(last_error=at, last_error_category=category, last_status_code=code)
            self.providers[stage]['failures'] += 1
        self.errors.append({'at': at, 'stage': stage, 'category': category, 'status_code': code})

    def snapshot(self, limits, configured, models):
        latency = {}
        for name, values in self.samples.items():
            ordered = sorted(values)
            latency[name] = {'samples': len(ordered), 'p50_ms': round(median(ordered), 2),
                             'p95_ms': ordered[math.ceil(len(ordered)*.95)-1], 'latest_ms': values[-1]}
        providers = {}
        for stage, record in self.providers.items():
            status = ('unconfigured' if not configured[stage] else
                      'degraded' if record['last_error'] and (not record['last_success'] or record['last_error'] > record['last_success'])
                      else 'observed_ok' if record['last_success'] else 'unobserved')
            providers[stage] = {**record, 'status': status, 'configured': configured[stage], 'model': models[stage]}
        return {'updated_at': timestamp(), 'started_at': self.started_at,
                'uptime_seconds': round(time.monotonic()-self.started), 'retention': 'process lifetime; latest 120 latency samples',
                'counts': {key: self.counts[key] for key in ['sessions_started', 'sessions_rejected', 'sessions_ended',
                    'utterances_started', 'utterances_completed', 'utterances_empty', 'utterances_interrupted',
                    'utterances_failed', 'interruptions', 'audio_bytes_sent']},
                'capacity': limits, 'providers': providers, 'latency': latency,
                'recent_errors': list(reversed(self.errors))}
