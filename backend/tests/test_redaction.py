"""Face / head redaction (Responsible AI — CLAUDE.md §22).

Covers the geometric head-region derivation, that obscuring destroys detail
only inside that region, the disabled / no-person no-ops, and that the
still-frame endpoint redacts by default and fails closed when weights are
missing.
"""

from __future__ import annotations

import numpy as np
import pytest
from starlette.testclient import TestClient

from backend.perception.redaction import (
    DEFAULT_REDACTION,
    RedactionConfig,
    head_region,
    redact_person_faces,
    redact_regions,
)


def _noise(h=480, w=640, seed=0):
    return np.random.default_rng(seed).integers(0, 256, (h, w, 3), dtype=np.uint8)


# ---------------------------------------------------------------------------
# head_region geometry
# ---------------------------------------------------------------------------

def test_head_region_is_top_slice_of_person_box():
    box = (100.0, 80.0, 200.0, 480.0)  # 100 wide, 400 tall
    x1, y1, x2, y2 = head_region(box, 640, 480, RedactionConfig(pad=0.0))
    # top of the region is the top of the person box, height ~= head_fraction
    assert y1 == 80
    assert y2 == pytest.approx(80 + 400 * DEFAULT_REDACTION.head_fraction, abs=1)
    # narrower than the person box, centred on it
    assert x1 > 100 and x2 < 200
    assert (x1 + x2) / 2 == pytest.approx(150, abs=1)


def test_head_region_clamps_to_frame_bounds():
    box = (-40.0, -30.0, 60.0, 200.0)  # partly off the top-left
    x1, y1, x2, y2 = head_region(box, 640, 480, DEFAULT_REDACTION)
    assert x1 >= 0 and y1 >= 0 and x2 <= 640 and y2 <= 480
    assert x2 > x1 and y2 > y1


def test_head_region_degenerate_for_box_outside_frame():
    assert head_region((700.0, 500.0, 800.0, 600.0), 640, 480, DEFAULT_REDACTION) == (0, 0, 0, 0)


# ---------------------------------------------------------------------------
# obscuring
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("method", ["pixelate", "gaussian"])
def test_redaction_destroys_detail_only_inside_the_head_region(method):
    img = _noise()
    box = (100.0, 80.0, 200.0, 400.0)
    cfg = RedactionConfig(method=method)
    x1, y1, x2, y2 = head_region(box, 640, 480, cfg)

    out = redact_person_faces(img, [box], cfg)

    # head region changed and lost variance (information destroyed)
    assert not np.array_equal(out[y1:y2, x1:x2], img[y1:y2, x1:x2])
    assert out[y1:y2, x1:x2].var() < img[y1:y2, x1:x2].var()
    # everything outside the head region is byte-identical
    assert np.array_equal(out[:y1], img[:y1])
    assert np.array_equal(out[y2:], img[y2:])
    assert np.array_equal(out[y1:y2, :x1], img[y1:y2, :x1])
    assert np.array_equal(out[y1:y2, x2:], img[y1:y2, x2:])


def test_input_image_is_never_mutated():
    img = _noise()
    ref = img.copy()
    redact_person_faces(img, [(10.0, 10.0, 110.0, 300.0)], DEFAULT_REDACTION)
    assert np.array_equal(img, ref)


def test_disabled_config_is_identity():
    img = _noise()
    out = redact_person_faces(img, [(10.0, 10.0, 110.0, 300.0)], RedactionConfig(enabled=False))
    assert np.array_equal(out, img)


def test_no_person_boxes_is_identity():
    img = _noise()
    assert np.array_equal(redact_person_faces(img, [], DEFAULT_REDACTION), img)


def test_redact_regions_skips_empty_and_clamps():
    img = _noise(100, 100)
    out = redact_regions(img, [(0, 0, 0, 0), (-5, -5, 20, 20), (90, 90, 500, 500)], DEFAULT_REDACTION)
    assert out.shape == img.shape
    # untouched middle band
    assert np.array_equal(out[40:60, 40:60], img[40:60, 40:60])


# ---------------------------------------------------------------------------
# still-frame endpoint
# ---------------------------------------------------------------------------

def _client_with_video():
    from backend.main import app
    from backend.api.videos import get_registry

    reg = get_registry()
    vids = reg.list_videos()
    if not vids:
        pytest.skip("no challenge videos available in this environment")
    return TestClient(app), vids[0].id


def test_frame_endpoint_redacts_by_default(monkeypatch):
    client, vid = _client_with_video()
    from backend.api import perception

    calls = {"n": 0}

    def spy(image):
        calls["n"] += 1
        return image  # geometry is covered by the unit tests above

    monkeypatch.setattr(
        type(perception.get_pipeline_registry()["stock"]),
        "redact_frame_image",
        staticmethod(spy),
    )

    r = client.get(f"/api/videos/{vid}/frame", params={"timestamp": 1.0})
    assert r.status_code == 200
    assert r.headers.get("X-TRACE-Redaction") == "faces-blurred"
    assert calls["n"] == 1


def test_frame_endpoint_can_be_told_not_to_redact():
    client, vid = _client_with_video()
    r = client.get(f"/api/videos/{vid}/frame", params={"timestamp": 1.0, "redact": "false"})
    assert r.status_code == 200
    assert r.headers.get("X-TRACE-Redaction") == "disabled"


def test_frame_endpoint_fails_closed_when_weights_missing(monkeypatch):
    client, vid = _client_with_video()
    from backend.api import perception

    def boom(_image):
        raise FileNotFoundError("weights not found")

    monkeypatch.setattr(type(perception.get_pipeline_registry()["stock"]), "redact_frame_image", staticmethod(boom))

    r = client.get(f"/api/videos/{vid}/frame", params={"timestamp": 1.0})
    assert r.status_code == 503
    assert "un-redacted" in r.json()["detail"]
