"""Machine Translation stage: translates transcribed text via Groq Llama.

Uses a strict system prompt to force output = translation only, no
commentary, no "Here's the translation:" prefixes - that kind of extra
text would otherwise get spoken aloud by the TTS stage downstream.
"""

from groq import Groq
from functools import lru_cache

from src.config import GROQ_API_KEY, MT_MODEL, PROVIDER_TIMEOUT

@lru_cache(maxsize=1)
def _client():
    return Groq(api_key=GROQ_API_KEY, timeout=PROVIDER_TIMEOUT, max_retries=0)

_SYSTEM_PROMPT = (
    "You are a translation engine, not a chatbot. "
    "Translate the user's message into {target_lang}. "
    "Output ONLY the translated text - no explanations, no quotes, "
    "no prefixes like 'Translation:', no commentary of any kind. "
    "If the input is already in {target_lang}, output it unchanged. "
    "If the input is empty or just noise, output nothing."
)


def translate(text: str, target_language_name: str) -> str:
    """Translate text into the target language.

    Returns empty string for empty input rather than calling the API -
    avoids wasting a request on silence-derived empty STT output.
    """
    if not text.strip():
        return ""

    system_prompt = _SYSTEM_PROMPT.format(target_lang=target_language_name)

    response = _client().chat.completions.create(
        model=MT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": text},
        ],
        temperature=0,  # deterministic output - no creative variation wanted
        max_tokens=500,
    )
    translated = response.choices[0].message.content
    return translated.strip() if translated else ""
