"""Tests for the regional Indian-language voice alert pipeline
(CLAUDE.md critical-pass Feature 2): the canonical phrase bank
(backend/intervention/alert_phrases.py), the TTS provider abstraction
(backend/intervention/tts.py), and the REST surface (backend/api/intervention.py).
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.intervention import alert_phrases as phrases
from backend.intervention import tts
from backend.main import app

REQUIRED_LANGS = {"en", "hi", "ta", "te", "kn", "ml", "mr", "bn", "gu", "pa"}


def test_all_ten_target_languages_are_registered():
    assert set(phrases.SUPPORTED_LANGUAGES.keys()) == REQUIRED_LANGS
    # Never Spanish, French, German, etc. — only the required Indian
    # languages plus English (CLAUDE.md: "verify no Spanish output anywhere").
    assert "es" not in phrases.SUPPORTED_LANGUAGES
    assert "fr" not in phrases.SUPPORTED_LANGUAGES


def test_every_canonical_scenario_has_all_ten_languages():
    for scenario, bank in phrases.SPOKEN_ALERTS.items():
        missing = REQUIRED_LANGS - set(bank.keys())
        assert not missing, f"{scenario} missing languages: {missing}"


def test_generic_fallback_has_all_ten_languages():
    assert REQUIRED_LANGS - set(phrases.GENERIC_ALERT.keys()) == set()


def test_alert_text_never_mixes_languages_on_fallback():
    # Unknown scenario, no fallback text supplied -> generic phrase IN the
    # requested language, not English text mislabeled as another language.
    text = phrases.alert_text("not_a_real_scenario", "ta")
    assert text == phrases.GENERIC_ALERT["ta"]

    # Unknown scenario WITH a fallback (e.g. the alert's own immediate_action)
    # -> the fallback text verbatim (it is already in English from the
    # planner), not a mistranslated guess.
    text2 = phrases.alert_text("not_a_real_scenario", "hi", fallback="Move the pallet back.")
    assert text2 == "Move the pallet back."

    # Known scenario, unsupported language code -> defaults to English
    # rather than raising or guessing.
    text3 = phrases.alert_text("stepping_on_carton", "es")
    assert text3 == phrases.SPOKEN_ALERTS["stepping_on_carton"]["en"]


def test_has_translation_reports_honestly():
    assert phrases.has_translation("stepping_on_carton", "hi") is True
    assert phrases.has_translation("not_a_real_scenario", "hi") is False
    assert phrases.has_translation("not_a_real_scenario", "en") is True  # English is always the base


def test_tts_cache_path_is_stable_for_the_same_text():
    p1 = tts._cache_path("stepping_on_carton", "hi", "same text")
    p2 = tts._cache_path("stepping_on_carton", "hi", "same text")
    p3 = tts._cache_path("stepping_on_carton", "hi", "different text")
    assert p1 == p2
    assert p1 != p3


def test_gtts_provider_supports_exactly_the_ten_languages():
    provider = tts.GTTSProvider()
    for lang in REQUIRED_LANGS:
        assert provider.supports(lang)
    assert not provider.supports("es")


def test_get_alert_audio_returns_real_cached_mp3_bytes():
    # This phrase was pregenerated to disk earlier, so this reads the cache —
    # no network call in the test run.
    text = phrases.SPOKEN_ALERTS["stepping_on_carton"]["hi"]
    audio = tts.get_alert_audio("stepping_on_carton", "hi", text)
    assert audio is not None
    # MP3: either an ID3 tag header, or a frame sync (0xFF followed by a byte
    # with its top 3 bits set).
    assert audio[:3] == b"ID3" or (audio[0] == 0xFF and (audio[1] & 0xE0) == 0xE0)


def test_get_alert_audio_provider_failure_returns_none_not_fabricated_audio(monkeypatch):
    class BrokenProvider:
        name = "broken"

        def supports(self, lang: str) -> bool:
            return True

        def synthesize(self, text: str, lang: str) -> bytes:
            raise RuntimeError("simulated network failure")

    monkeypatch.setattr(tts, "_PROVIDERS", [BrokenProvider()])
    audio = tts.get_alert_audio(
        "not_a_real_scenario", "hi", "some text that was never cached before " + "x" * 5,
    )
    assert audio is None


def test_alert_text_api_endpoint_returns_the_canonical_phrase():
    client = TestClient(app)
    resp = client.get("/api/intervention/alert-text", params={"scenario": "solo_heavy_handling", "lang": "te"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["language"] == "te"
    assert body["text"] == phrases.SPOKEN_ALERTS["solo_heavy_handling"]["te"]
    assert body["has_reviewed_translation"] is True


def test_alert_text_api_rejects_unsupported_language():
    client = TestClient(app)
    resp = client.get("/api/intervention/alert-text", params={"scenario": "solo_heavy_handling", "lang": "es"})
    assert resp.status_code == 422


def test_alert_audio_api_serves_real_mp3():
    client = TestClient(app)
    resp = client.get("/api/intervention/alert-audio", params={"scenario": "solo_heavy_handling", "lang": "mr"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mpeg"
    assert len(resp.content) > 1000


def test_languages_endpoint_exposes_no_provider_terminology():
    client = TestClient(app)
    resp = client.get("/api/intervention/languages")
    assert resp.status_code == 200
    body = resp.json()
    codes = {row["code"] for row in body["languages"]}
    assert codes == REQUIRED_LANGS
    dumped = str(body).lower()
    for banned in ("gtts", "google", "api key", "provider", "model"):
        assert banned not in dumped


def test_alert_language_preference_round_trips(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACE_DB_PATH", str(tmp_path / "lang_pref.db"))
    from backend.db.db import create_database
    create_database().close()

    client = TestClient(app)
    default = client.get("/api/intervention/alert-language").json()
    assert default["language"] == "en"

    put_resp = client.put("/api/intervention/alert-language", params={"language": "kn"})
    assert put_resp.status_code == 200
    assert client.get("/api/intervention/alert-language").json()["language"] == "kn"


def test_alert_language_preference_rejects_unsupported_language(tmp_path, monkeypatch):
    monkeypatch.setenv("TRACE_DB_PATH", str(tmp_path / "lang_pref2.db"))
    from backend.db.db import create_database
    create_database().close()

    client = TestClient(app)
    resp = client.put("/api/intervention/alert-language", params={"language": "es"})
    assert resp.status_code == 422
