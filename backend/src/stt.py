"""Speech-to-Text stage: converts raw mic PCM audio to text via Groq Whisper.

Takes 48kHz raw PCM chunks (from browser mic), downsamples to 16kHz
(what Whisper expects), wraps in an in-memory WAV container, and
sends to Groq's whisper-large-v3-turbo for transcription.
"""

import io
import wave
from functools import lru_cache

import numpy as np
from scipy.signal import resample_poly
from groq import Groq

from src.config import GROQ_API_KEY, STT_MODEL, STT_INPUT_RATE, PROVIDER_TIMEOUT

@lru_cache(maxsize=1)
def _client():
    return Groq(api_key=GROQ_API_KEY, timeout=PROVIDER_TIMEOUT, max_retries=0)


def _downsample_48k_to_16k(pcm_bytes: bytes) -> bytes:
    """Downsample 48kHz int16 PCM to 16kHz using polyphase filtering.

    resample_poly(up=1, down=3) applies an anti-aliasing lowpass filter
    before dropping samples - plain decimation (every 3rd sample) would
    fold high frequencies back as audible noise.
    """
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    downsampled = resample_poly(samples, up=1, down=3)
    return downsampled.astype(np.int16).tobytes()


def _pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int) -> bytes:
    """Wrap headerless PCM in a minimal WAV container in memory.

    Whisper's API needs a real audio file (with header), not raw PCM.
    Building this in-memory avoids writing temp files to disk per chunk.
    """
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)       # mono - mic capture is single channel
        wf.setsampwidth(2)       # int16 = 2 bytes per sample
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    buf.seek(0)
    return buf.read()


def transcribe_chunk(pcm_48k: bytes, language: str | None = None) -> str:
    """Transcribe one buffered chunk of mic audio.

    Returns empty string on silence/no-speech chunks rather than raising -
    silence is a normal, frequent case in real-time capture, not an error.
    """
    pcm_16k = _downsample_48k_to_16k(pcm_48k)
    wav_bytes = _pcm_to_wav_bytes(pcm_16k, STT_INPUT_RATE)

    response = _client().audio.transcriptions.create(
        file=("chunk.wav", wav_bytes),
        model=STT_MODEL,
        response_format="text",
        **({'language': language} if language else {}),
    )
    text = response.strip() if isinstance(response, str) else str(response).strip()
    return text
