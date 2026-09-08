"""Regression tests for the What-If simulation fixes.

Covers:
- P0-2: unified epistemic gate — trajectory engine refuses ineligible /
  unspecified scenarios instead of silently coercing to "box_overhang".
- P0-3: candidate deltas are computed against the real observed stability at
  the intervention frame, not a hardcoded 50.0.
- P0-4: one shared stability->band mapping across both engines.
- P1-5: like-for-like comparison — trajectories are restricted to the
  contiguous window where the same target track is actually present, and the
  result carries `comparison_caveat` / `confidence`.
- P1-6: candidate feasibility flags cargo/structure collisions and off-deck
  placements.
- P1-7: POST /api/planner/whatif rejects a request with neither event_id nor
  an explicit timestamp.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from backend.contracts.models import (
    BoundingBox,
    Entity,
    EntityClass,
    PerceptionFrameResult,
    RiskBand,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.main import app
from backend.planner.generator import generate_placement_candidates
from backend.planner.stability import classify_stability, risk_band_from_stability
from backend.planner.whatif import run_what_if_trajectory
from backend.world_model.scene_graph import WorldModel


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------

class _Meta:
    width = 1920
    height = 1080
    fps = 30.0
    duration = 20.0


class _Record:
    id = "vid_fix"
    filename = "vid_fix.mp4"
    metadata = _Meta()


class _Registry:
    def get(self, video_id):
        return _Record() if video_id == "vid_fix" else None


# Fixtures are written in normalized [0, 1] coordinates for readability; the
# world model consumes Entity.bbox in absolute pixels, so scale by the fake
# frame size before constructing the entities.
_W, _H = _Meta.width, _Meta.height


def _box(x1, x2, *, y1=0.30, y2=0.58):
    return BoundingBox(x1=x1 * _W, y1=y1 * _H, x2=x2 * _W, y2=y2 * _H)


def _frame(t, *, box=None, pallet=(0.20, 0.80)):
    ents = [
        Entity(
            id="pallet_1", track_id="2", timestamp=t,
            entity_class=EntityClass.PALLET, confidence=0.95,
            bbox=BoundingBox(x1=pallet[0] * _W, y1=0.60 * _H, x2=pallet[1] * _W, y2=0.80 * _H),
        )
    ]
    if box is not None:
        ents.insert(
            0,
            Entity(
                id="box_1", track_id="1", timestamp=t,
                entity_class=EntityClass.BOX, confidence=0.90, bbox=box,
            ),
        )
    return PerceptionFrameResult(source_id="vid_fix", timestamp=t, entities=ents)


def _run(monkeypatch, frames, **kwargs):
    from backend.api import perception

    monkeypatch.setattr(
        perception, "get_cached_results",
        lambda video_id, registry, pipeline, model: frames,
    )
    defaults = dict(
        video_id="vid_fix",
        timestamp=3.0,
        entity_id="box_1",
        scenario="box_overhang",
        registry=_Registry(),
        pipelines={"pilot": object()},
        world_model=WorldModel(),
    )
    defaults.update(kwargs)
    return run_what_if_trajectory(**defaults)


# ---------------------------------------------------------------------------
# P0-4 — one shared stability -> band mapping
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "stability, expected",
    [
        (95.0, RiskBand.LOW),
        (80.0, RiskBand.LOW),
        (79.9, RiskBand.MEDIUM),
        (60.0, RiskBand.MEDIUM),
        (59.9, RiskBand.HIGH),
        (40.0, RiskBand.HIGH),
        (39.9, RiskBand.CRITICAL),
        (0.0, RiskBand.CRITICAL),
    ],
)
def test_risk_band_matches_stability_classification(stability, expected):
    assert risk_band_from_stability(stability) == expected
    # cut points are the exact complement of classify_stability
    cls = classify_stability(stability)
    assert (cls == "high_geometric_support") == (expected == RiskBand.LOW)
    assert (cls == "poor_geometric_support") == (expected == RiskBand.CRITICAL)


# ---------------------------------------------------------------------------
# P0-2 — no silent scenario default
# ---------------------------------------------------------------------------

def test_trajectory_refuses_unspecified_scenario(monkeypatch):
    # No event_id and no scenario == manual timestamp mode with no incident
    # context: refused with a specific, actionable message rather than silently
    # coerced to "box_overhang".
    res = _run(monkeypatch, [_frame(3.0, box=_box(0.74, 0.98))], scenario=None)
    assert res.simulation_available is False
    assert "manual_mode_requires_incident_context" in res.limitations


def test_trajectory_refuses_non_placement_scenario(monkeypatch):
    res = _run(
        monkeypatch,
        [_frame(3.0, box=_box(0.74, 0.98))],
        scenario="entity_in_wet_floor_zone",
    )
    assert res.simulation_available is False
    assert "non_placement_scenario" in res.limitations


# ---------------------------------------------------------------------------
# P0-3 — candidate delta is relative to the observed baseline, not 50.0
# ---------------------------------------------------------------------------

def test_candidate_delta_is_relative_to_observed_baseline(monkeypatch):
    # Heavy overhang: observed stability is well under 50, so a candidate that
    # merely reaches ~50 would show a *positive* delta only if the baseline is
    # the real observed score.
    frames = [_frame(t, box=_box(0.74, 0.995)) for t in (2.0, 3.0, 4.0)]
    res = _run(monkeypatch, frames)
    assert res.simulation_available is True
    obs = res.original_trajectory[res.original_trajectory.index(
        next(p for p in res.original_trajectory if p.is_placement_moment)
    )]
    for cand in res.available_candidates:
        assert cand.score_delta == pytest.approx(round(cand.score - obs.stability_score, 1), abs=0.11)


# ---------------------------------------------------------------------------
# P1-5 — like-for-like: contiguous same-track window + caveat/confidence
# ---------------------------------------------------------------------------

def test_trajectory_truncates_at_target_track_loss(monkeypatch):
    # box_1 present at t=2,3,4 then the track drops out at t=5,6.
    frames = [
        _frame(2.0, box=_box(0.40, 0.70)),
        _frame(3.0, box=_box(0.74, 0.98)),
        _frame(4.0, box=_box(0.74, 0.98)),
        _frame(5.0),  # box_1 absent
        _frame(6.0),  # box_1 absent
    ]
    res = _run(monkeypatch, frames, window_before=3.0, window_after=4.0)
    assert res.simulation_available is True
    # Points after the track is lost are not fabricated.
    assert len(res.original_trajectory) == 3
    assert len(res.simulated_trajectory) == 3
    assert all(p.evidence == "observed" for p in res.original_trajectory)
    assert all(p.evidence == "observed" for p in res.simulated_trajectory)


def test_result_carries_comparison_caveat_and_confidence(monkeypatch):
    frames = [_frame(t, box=_box(0.74, 0.98)) for t in (2.0, 3.0, 4.0, 5.0)]
    res = _run(monkeypatch, frames)
    assert res.simulation_available is True
    assert res.comparison_caveat
    assert "not symmetric" in res.comparison_caveat.lower()
    assert res.confidence == "normal"


def test_short_window_is_flagged_low_confidence(monkeypatch):
    res = _run(monkeypatch, [_frame(3.0, box=_box(0.74, 0.98))])
    assert res.simulation_available is True
    assert res.confidence == "low"
    assert "sparse_or_discontinuous_track" in res.limitations


# ---------------------------------------------------------------------------
# P1-6 — candidate feasibility
# ---------------------------------------------------------------------------

def _node(entity_id, cls, x1, x2, *, y1, y2):
    return SceneGraphNode(
        entity_id=entity_id, entity_class=cls,
        position=((x1 + x2) / 2.0, (y1 + y2) / 2.0),
        footprint=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
    )


def test_candidate_flagged_when_it_collides_with_other_cargo():
    target = _node("box_target", EntityClass.BOX, 0.60, 0.90, y1=0.30, y2=0.55)
    support = _node("pallet_1", EntityClass.PALLET, 0.20, 0.80, y1=0.55, y2=0.75)
    # Another carton occupying the centered position the generator will propose.
    blocker = _node("box_blocker", EntityClass.BOX, 0.36, 0.64, y1=0.30, y2=0.55)
    snap = SceneGraphSnapshot(
        timestamp=1.0, nodes=[target, support, blocker],
        edges=[SceneGraphEdge(source_id="box_target", target_id="pallet_1",
                              edge_type=SceneGraphEdgeType.SUPPORT, weight=1.0)],
    )
    cands = generate_placement_candidates(
        target, support, snap, scenario_key="box_overhang", current_score=30.0,
    )
    centered = next((c for c in cands if c.id == "cand_center_support"), None)
    assert centered is not None
    assert centered.feasibility is False
    assert any("overlaps another cargo" in lim for lim in centered.limitations)


# ---------------------------------------------------------------------------
# P2 — no infeasible recommendation, static counterfactual, k-guard
# ---------------------------------------------------------------------------

def test_refuses_when_no_candidate_is_feasible(monkeypatch):
    # A narrow support hard against the right frame edge, with a wide box
    # overhanging it: every generated alternative (centre / shift / rotate) gets
    # clamped onto the frame boundary or off the deck and fails feasibility, so
    # the engine must refuse rather than headline an improvement from a
    # placement nobody can make.
    frames = [
        _frame(t, box=_box(0.75, 0.999), pallet=(0.90, 0.99)) for t in (2.0, 3.0, 4.0)
    ]
    res = _run(monkeypatch, frames)
    assert res.simulation_available is False
    assert "no_feasible_candidate" in res.limitations
    assert "none satisfy" in (res.simulation_notice or "")


def test_counterfactual_is_held_static_not_translated(monkeypatch):
    # The observed box drifts left across the window after the intervention.
    # The counterfactual must hold the repositioned box at ONE footprint, so its
    # post-intervention curve is flat (no per-frame value produced by sliding
    # the box along the observed motion path).
    frames = [
        _frame(2.0, box=_box(0.55, 0.80)),
        _frame(3.0, box=_box(0.55, 0.80)),   # intervention frame
        _frame(4.0, box=_box(0.45, 0.70)),
        _frame(5.0, box=_box(0.35, 0.60)),
    ]
    res = _run(monkeypatch, frames, window_before=3.0, window_after=4.0)
    assert res.simulation_available is True
    k = next(i for i, p in enumerate(res.simulated_trajectory) if p.is_placement_moment)
    post = [round(p.stability_score, 2) for p in res.simulated_trajectory[k:]]
    assert len(set(post)) == 1, f"counterfactual not held static: {post}"


def test_no_pre_intervention_context_is_flagged(monkeypatch):
    # Single-frame window: the intervention frame is index 0, so there is no
    # "before" context — the result must say so and drop to low confidence.
    res = _run(monkeypatch, [_frame(3.0, box=_box(0.55, 0.80))])
    assert res.simulation_available is True
    assert res.confidence == "low"
    assert "no_pre_intervention_frames" in res.limitations


# ---------------------------------------------------------------------------
# P1-7 — API argument validation
# ---------------------------------------------------------------------------

def test_api_whatif_requires_timestamp_without_event():
    client = TestClient(app)
    resp = client.post("/api/planner/whatif", json={"video_id": "vid_fix"})
    assert resp.status_code == 422
    assert "timestamp" in resp.json()["detail"].lower()
