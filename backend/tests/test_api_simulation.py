"""Integration tests for Safe Action Planner and What-If Simulation API endpoints."""

from fastapi.testclient import TestClient

from backend.api.videos import get_registry
from backend.main import app

client = TestClient(app)


def test_simulation_api_unknown_video_404():
    res = client.post(
        "/api/videos/nonexistent_id/what-if",
        json={"timestamp": 1.0, "model": "stock"},
    )
    assert res.status_code == 404


def test_simulation_api_out_of_range_timestamp_422():
    registry = get_registry()
    videos = list(registry._records.values())
    if not videos:
        return
    vid = videos[0].id
    res = client.post(
        f"/api/videos/{vid}/what-if",
        json={"timestamp": 9999.0, "model": "stock"},
    )
    assert res.status_code == 422


def test_simulation_api_real_clip_get_and_post():
    registry = get_registry()
    target_rec = None
    for rec in registry._records.values():
        if "KD packets dragged" in rec.filename or "Rolling and dropping" in rec.filename:
            target_rec = rec
            break
    if not target_rec:
        return

    # Test POST /api/videos/{id}/what-if
    res = client.post(
        f"/api/videos/{target_rec.id}/what-if",
        json={"timestamp": 2.0, "model": "pilot"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "video_id" in data
    assert "simulation_available" in data
    assert "simulation_notice" in data
    assert "limitations" in data

    # If simulation ran, check the comparison structure
    if data["simulation_available"]:
        assert data["current"] is not None
        assert "stability_score" in data["current"]
        assert "classification" in data["current"]
        assert "breakdown" in data["current"]
        assert len(data["alternatives"]) > 0
        cand = data["alternatives"][0]
        assert "score" in cand
        assert "score_delta" in cand
        assert "description" in cand

    # Test POST /api/videos/{id}/simulate-placement alias
    res_alias = client.post(
        f"/api/videos/{target_rec.id}/simulate-placement",
        json={"timestamp": 2.0, "model": "pilot"},
    )
    assert res_alias.status_code == 200
    assert res_alias.json()["video_id"] == target_rec.id

    # Test GET /api/videos/{id}/what-if
    res_get = client.get(
        f"/api/videos/{target_rec.id}/what-if?timestamp=2.0&model=pilot"
    )
    assert res_get.status_code == 200
    assert res_get.json()["video_id"] == target_rec.id
