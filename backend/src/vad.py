"""Voice Activity Detection: energy-based speech/silence classification.

Simple RMS-threshold approach - not ML-based, but cheap and fast enough
to run per-frame in real time. Good enough to fix the two symptoms we
were seeing: mid-sentence cuts and Whisper hallucinating "." on silence.
"""

import numpy as np

from src.config import VAD_SILENCE_THRESHOLD


def is_speech(pcm_frame: bytes) -> bool:
    """Return True if this frame's energy is above the silence threshold.

    RMS (root-mean-square) gives a stable "loudness" measure - more
    robust than peak amplitude, which can spike on a single click/pop
    even during otherwise-silent audio.
    """
    samples = np.frombuffer(pcm_frame, dtype=np.int16)
    if len(samples) == 0:
        return False
    rms = np.sqrt(np.mean(samples.astype(np.float64) ** 2))
    return bool(rms > VAD_SILENCE_THRESHOLD)
