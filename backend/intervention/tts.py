"""Regional Indian-language voice alert audio (CLAUDE.md critical-pass
Feature 2: multilingual voice alerts).

The browser's Web Speech API (`speechSynthesis`) depends on whatever voices
happen to be installed on the operator's OS/browser. When the requested
language has no installed voice, the browser silently falls back to whatever
default voice IS installed — which is how this system was previously
producing wrong-language (e.g. Spanish) speech for a Hindi/Tamil/etc. alert:
the *label* said Hindi, the *voice* was whatever the machine had.

This module renders the actual requested language server-side via a small
provider abstraction (`_PROVIDERS`) so a different Indian-language TTS
engine can be substituted without touching callers. The only provider wired
up today is `GTTSProvider` (Google Translate TTS via the `gtts` package),
which never silently substitutes a different language — it either speaks
the requested one or synthesis fails and `get_alert_audio` returns `None`.

Canonical alert text lives in `backend/intervention/alert_phrases.py`, not
here — this module only turns already-resolved text into audio, and caches
the result to disk (`data/tts_cache/`) keyed by (scenario, language, text
hash), since the phrase bank is fixed reviewed text repeated across a shift.
"""

from __future__ import annotations

import hashlib
import io
import logging
from pathlib import Path
from typing import Optional, Protocol

from backend.intervention.alert_phrases import GENERIC_ALERT, SPOKEN_ALERTS, SUPPORTED_LANGUAGES

logger = logging.getLogger("trace.intervention.tts")

CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "tts_cache"


class TTSProvider(Protocol):
    name: str

    def supports(self, lang: str) -> bool: ...

    def synthesize(self, text: str, lang: str) -> bytes: ...


class GTTSProvider:
    """Google Translate TTS via the `gtts` package. Genuinely renders each
    of the 10 supported languages server-side (see module docstring)."""

    name = "gtts"

    def supports(self, lang: str) -> bool:
        return lang in SUPPORTED_LANGUAGES

    def synthesize(self, text: str, lang: str) -> bytes:
        from gtts import gTTS  # optional network dependency, imported lazily

        buf = io.BytesIO()
        gTTS(text=text, lang=lang).write_to_fp(buf)
        audio = buf.getvalue()
        if not audio:
            raise RuntimeError("gTTS returned no audio")
        return audio


# Ordered list of providers tried for each request. A test-only broken
# provider can be swapped in via monkeypatch to exercise the "synthesis
# failed" path without a real network call.
_PROVIDERS: list = [GTTSProvider()]


def _cache_path(scenario: str, lang: str, text: str) -> Path:
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    safe_scenario = "".join(c if c.isalnum() or c == "_" else "_" for c in (scenario or "alert"))
    return CACHE_DIR / f"{safe_scenario}_{lang}_{digest}.mp3"


def get_alert_audio(scenario: Optional[str], lang: str, text: str) -> Optional[bytes]:
    """Real MP3 bytes for `text` spoken in `lang`, or `None` if no provider
    could produce it. Never fabricates audio and never silently substitutes
    a different language — a failure is reported as `None`, not a wrong- or
    empty-sounding file."""
    text = (text or "").strip()
    if not text:
        return None

    path = _cache_path(scenario or "alert", lang, text)
    if path.exists():
        try:
            return path.read_bytes()
        except OSError:
            pass  # fall through and regenerate

    for provider in _PROVIDERS:
        if not provider.supports(lang):
            continue
        try:
            audio = provider.synthesize(text, lang)
        except Exception:
            logger.warning(
                "TTS provider %s failed for lang=%s", getattr(provider, "name", "?"), lang, exc_info=True
            )
            continue
        if not audio:
            continue
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            path.write_bytes(audio)
        except OSError:
            logger.warning("Could not write TTS cache file %s", path, exc_info=True)
        return audio

    return None


def pregenerate_all() -> dict:
    """Synthesizes and caches audio for every (scenario, language) phrase in
    the bank plus the generic fallback, so the live demo never depends on a
    network call mid-shift. Safe to re-run — already-cached files are
    skipped, never regenerated or overwritten."""
    generated = skipped = failed = 0

    def _run(scenario: str, bank: dict[str, str]) -> None:
        nonlocal generated, skipped, failed
        for lang, text in bank.items():
            if _cache_path(scenario, lang, text).exists():
                skipped += 1
                continue
            audio = get_alert_audio(scenario, lang, text)
            if audio:
                generated += 1
            else:
                failed += 1

    for scenario, bank in SPOKEN_ALERTS.items():
        _run(scenario, bank)
    _run("generic", GENERIC_ALERT)

    return {"generated": generated, "skipped": skipped, "failed": failed}
