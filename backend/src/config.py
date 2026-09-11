"""Central configuration for the real-time voice translator.

Loads API keys from .env and defines every constant the pipeline needs:
model IDs, audio sample rates, and the language menu.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- API Keys ---
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")  # chosen TTS engine

# --- Models ---
# whisper-large-v3-turbo: fastest Groq STT model, near-large-v3 accuracy, lower latency.
STT_MODEL: str = "whisper-large-v3-turbo"
# llama-3.3-70b-versatile: high accuracy multilingual translation with low latency.
MT_MODEL: str = "llama-3.3-70b-versatile"
# ElevenLabs default multilingual voice model - handles all target languages in LANGUAGES dict.
TTS_MODEL: str = "eleven_multilingual_v2"
TTS_VOICE_ID: str = os.getenv("TTS_VOICE_ID", "3AMU7jXQuQa3oRvRqUmb")  # configurable ElevenLabs voice ID

# --- Audio rate constants ---
# Whisper API expects 16kHz mono PCM/WAV input.
# Browser mic (WebRTC) always captures at 48kHz - resampling mandatory before sending to STT.
MIC_RATE: int = 48_000       # browser WebRTC standard capture rate
STT_INPUT_RATE: int = 16_000  # Whisper expects this
TTS_OUTPUT_RATE: int = 24_000 # typical TTS output rate (adjust based on engine chosen)

# --- Chunking ---
# Old approach was a fixed-duration timer (3s) - cut audio mid-sentence
# regardless of what was being said. Replaced with speech-triggered
# (VAD-based) chunking below: buffer while speech is detected, flush on
# a natural pause. Kept for reference/rollback only, no longer used
# by pipeline.py.
CHUNK_DURATION_SECONDS: float = 3.0

# --- VAD (Voice Activity Detection) tuning ---
# Frame size for VAD analysis - small enough for responsive detection,
# large enough for a stable RMS reading. 20ms is a common speech-processing default.
VAD_FRAME_MS: int = 20
# RMS amplitude below this = treated as silence. int16 range is -32768..32767.
# Typical room noise/mic hiss sits under 300; real speech is usually 1000+.
# Device-dependent - raise this if silence is still triggering false speech detection,
# lower it if quiet speech is being missed.
VAD_SILENCE_THRESHOLD: int = 700
# How long a pause must last before we treat it as end-of-sentence and flush.
# Too short = cuts sentences mid-word on natural micro-pauses. Too long = laggy.
VAD_SILENCE_DURATION_MS: int = 600
# Safety cap: flush anyway after this many seconds even without a pause,
# so a person talking continuously without pausing doesn't create unbounded
# latency waiting for a gap that never comes.
VAD_MAX_CHUNK_SECONDS: float = 8.0
# Minimum speech length to bother sending to Whisper - filters out tiny
# blips (coughs, mic clicks) that would otherwise waste an API call.
VAD_MIN_CHUNK_SECONDS: float = 0.3

# --- Languages ---
# Keys = display names shown in UI. Values = language codes the MT prompt uses.
LANGUAGES: dict[str, str] = {
    "English": "en",
    "Hindi": "hi",
    "Tamil": "ta",
    "Telugu": "te",
    "Spanish": "es",
    "French": "fr",
    "German": "de",
    "Japanese": "ja",
}
