"""Shared audio utilities used across the pipeline."""

import numpy as np


def upsample_24k_to_48k(pcm_bytes: bytes) -> bytes:
    """Upsample 24kHz int16 PCM to 48kHz via exact sample repetition.

    Exact 2x integer ratio - np.repeat duplicates each sample
    ([a,b,c] -> [a,a,b,b,c,c]) with no aliasing risk, since we're only
    adding samples, not removing them. Cheaper and click-free compared
    to a filter-based resampler on small streaming chunks.
    """
    samples = np.frombuffer(pcm_bytes, dtype=np.int16)
    return np.repeat(samples, 2).tobytes()
