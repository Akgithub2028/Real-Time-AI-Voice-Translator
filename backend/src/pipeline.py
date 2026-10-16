"""Pipeline orchestrator: VAD-based buffering, then chains STT -> MT -> TTS.

Replaces the old fixed-duration (3s timer) chunking. That approach cut
audio mid-sentence regardless of what was being said, which produced
garbled transcriptions, and sent pure-silence chunks to Whisper, which
hallucinated filler text (".") instead of returning empty.

New approach: analyze incoming audio in small 20ms frames. Accumulate
frames while speech is detected. Flush (send to STT) when a natural
pause is detected - that pause is a much better sentence boundary than
an arbitrary timer.
"""

from collections.abc import Iterator
from threading import Event
import time

from src.config import (
    MIC_RATE,
    VAD_FRAME_MS,
    VAD_SILENCE_DURATION_MS,
    VAD_MAX_CHUNK_SECONDS,
    VAD_MIN_CHUNK_SECONDS,
    LANGUAGES,
)
from src.vad import is_speech
from src.stt import transcribe_chunk
from src.mt import translate
from src.tts import synthesize_stream
from src.audio_utils import upsample_24k_to_48k

_BYTES_PER_SAMPLE = 2  # int16 mono
_FRAME_BYTES = int(MIC_RATE * VAD_FRAME_MS / 1000) * _BYTES_PER_SAMPLE
_MAX_CHUNK_BYTES = int(MIC_RATE * VAD_MAX_CHUNK_SECONDS) * _BYTES_PER_SAMPLE
_MIN_CHUNK_BYTES = int(MIC_RATE * VAD_MIN_CHUNK_SECONDS) * _BYTES_PER_SAMPLE

# Whisper sometimes hallucinates common YouTube-outro phrases on
# near-silent/quiet audio instead of returning empty text. These are the
# most frequently reported ones. Matched as an exact, case-insensitive
# string - a real sentence containing "thank you" plus other words won't
# match this, so it only catches the isolated hallucination pattern.
_WHISPER_HALLUCINATIONS = {
    "thanks for watching", "thanks for watching!",
    "thank you for watching", "thank you for watching!",
    "please subscribe",
}


class TranslationPipeline:
    """Buffers mic audio using VAD, runs a translation cycle per detected utterance."""

    def __init__(self, target_language_name: str, source_language_name: str | None = None) -> None:
        if target_language_name not in LANGUAGES:
            raise ValueError(f"Unknown target language: {target_language_name}")
        self._target_lang = target_language_name
        if source_language_name is not None and source_language_name not in LANGUAGES:
            raise ValueError('Unknown source language')
        self.source_language = source_language_name
        self.last_speech_at = None

        self._raw_buffer = bytearray()      # unprocessed audio, not yet frame-aligned
        self._speech_buffer = bytearray()   # accumulated speech waiting to be flushed
        self._in_speech = False
        self._silence_run_ms = 0
        self._speech_bytes = 0
        self.cancelled = Event()
        self.reserve_request = lambda: None
        self.reserve_characters = lambda count: None

    def feed(self, pcm_48k_chunk: bytes) -> Iterator[dict]:
        """Feed raw mic audio in. Yields result dicts whenever an utterance completes."""
        for chunk in self.feed_audio(pcm_48k_chunk):
            yield from self._run_cycle(chunk)

    def feed_audio(self, pcm_48k_chunk: bytes) -> list[bytes]:
        """Fast VAD ingestion only; provider work is queued separately by the server."""
        utterances = []
        self._raw_buffer.extend(pcm_48k_chunk)

        while len(self._raw_buffer) >= _FRAME_BYTES:
            frame = bytes(self._raw_buffer[:_FRAME_BYTES])
            del self._raw_buffer[:_FRAME_BYTES]
            utterances.extend(self._process_frame(frame))
        return utterances

    def _process_frame(self, frame: bytes) -> Iterator[dict]:
        if is_speech(frame):
            self.last_speech_at = time.perf_counter()
            self._speech_buffer.extend(frame)
            self._speech_bytes += len(frame)
            self._in_speech = True
            self._silence_run_ms = 0
        elif self._in_speech:
            # Include the trailing silence frame too - a short natural tail
            # avoids an abrupt clip right at the end of the last word.
            self._speech_buffer.extend(frame)
            self._silence_run_ms += VAD_FRAME_MS
            if self._silence_run_ms >= VAD_SILENCE_DURATION_MS:
                yield from self._flush_audio()
        # else: leading silence before any speech started - discard, don't buffer.

        # Safety cap - don't let one continuous utterance (person talking
        # without pausing) grow unbounded and stall the pipeline.
        if self._in_speech and len(self._speech_buffer) >= _MAX_CHUNK_BYTES:
            yield from self._flush_audio()

    def _flush_audio(self) -> Iterator[bytes]:
        """Send the accumulated speech buffer through STT -> MT -> TTS, then reset."""
        chunk = bytes(self._speech_buffer)
        speech_bytes = self._speech_bytes
        self._speech_buffer = bytearray()
        self._speech_bytes = 0
        self._in_speech = False
        self._silence_run_ms = 0

        if speech_bytes < _MIN_CHUNK_BYTES:
            return  # too short to be real speech (cough, click) - skip the API calls

        yield chunk

    def finalize(self) -> Iterator[dict]:
        """Flush any remaining buffered speech - call this on disconnect/session end."""
        for chunk in self.finalize_audio():
            yield from self._run_cycle(chunk)

    def finalize_audio(self) -> list[bytes]:
        if self._in_speech and self._raw_buffer:
            self._speech_buffer.extend(self._raw_buffer)
        self._raw_buffer.clear()
        if self._in_speech:
            return list(self._flush_audio())
        return []

    def _run_cycle(self, pcm_48k: bytes) -> Iterator[dict]:
        """Run one STT -> MT -> TTS cycle for a single detected utterance."""
        if self.cancelled.is_set():
            return
        self.reserve_request()
        yield {'type': 'status', 'stage': 'transcribing'}
        if self.cancelled.is_set():
            return
        started = time.perf_counter()
        source_text = transcribe_chunk(pcm_48k, **({'language': LANGUAGES[self.source_language]} if self.source_language else {}))
        if self.cancelled.is_set():
            return
        yield {'type': 'timing', 'stage': 'stt', 'duration_ms': round((time.perf_counter()-started)*1000, 2)}
        if not source_text or source_text.strip(" .") == "":
            return  # empty or Whisper's silence-hallucination artifact

        # Catch the "Thank you." style hallucination - Whisper's other
        # common failure mode on quiet/near-silent audio.
        normalized = source_text.strip().lower()
        if normalized in _WHISPER_HALLUCINATIONS:
            return

        yield {'type': 'status', 'stage': 'translating'}
        if self.cancelled.is_set():
            return
        started = time.perf_counter()
        translated_text = translate(source_text, self._target_lang)
        if self.cancelled.is_set():
            return
        yield {'type': 'timing', 'stage': 'translation', 'duration_ms': round((time.perf_counter()-started)*1000, 2)}
        if not translated_text:
            return

        yield {
            "type": "transcript",
            "source_text": source_text,
            "translated_text": translated_text,
        }

        if self.cancelled.is_set():
            return
        self.reserve_characters(len(translated_text))
        if self.cancelled.is_set():
            return
        yield {'type': 'status', 'stage': 'speaking'}
        if self.cancelled.is_set():
            return
        started = time.perf_counter()
        first = True
        for tts_chunk_24k in synthesize_stream(translated_text):
            if self.cancelled.is_set():
                return
            if first:
                first = False
                yield {'type': 'timing', 'stage': 'tts_first_byte', 'duration_ms': round((time.perf_counter()-started)*1000, 2)}
            audio_48k = upsample_24k_to_48k(tts_chunk_24k)
            yield {"type": "audio", "data": audio_48k}
