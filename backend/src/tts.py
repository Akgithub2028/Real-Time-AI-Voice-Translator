"""Text-to-Speech stage: converts translated text to speech via ElevenLabs.

Uses ElevenLabs' streaming endpoint requesting raw PCM output directly -
avoids an MP3-decode step that would add latency before playback.
"""

from collections.abc import Iterator

from elevenlabs.client import ElevenLabs

from src.config import ELEVENLABS_API_KEY, TTS_MODEL, TTS_VOICE_ID

_client = ElevenLabs(api_key=ELEVENLABS_API_KEY)


def synthesize_stream(text: str) -> Iterator[bytes]:
    """Stream synthesized speech as raw 24kHz PCM chunks.

    Yields chunks as they arrive rather than returning one big blob -
    lets the caller start forwarding audio to the browser before the
    full sentence has finished generating.
    """
    if not text.strip():
        return

    audio_stream = _client.text_to_speech.convert(
        voice_id=TTS_VOICE_ID,
        model_id=TTS_MODEL,
        text=text,
        output_format="pcm_24000",  # raw PCM, 24kHz - matches TTS_OUTPUT_RATE in config
    )
    for chunk in audio_stream:
        if chunk:
            yield chunk
