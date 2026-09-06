"""Centralized, documented thresholds for Phase 5 evidence/risk lenses.

Every lens reads its thresholds from here rather than hardcoding numbers,
so a finding's sensitivity is auditable and tunable in one place instead
of scattered magic numbers (CLAUDE.md §10/§30 — confidence must be
explainable, not a black box).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RiskConfig:
    # BEHAVIOUR — sustained PERSON<->BOX proximity (normalized distance,
    # reuses the same coordinate system as world_model.proximity_threshold
    # but kept separate/configurable since "behaviourally relevant" and
    # "spatially adjacent" are different judgment calls).
    behaviour_proximity_threshold: float = 0.15
    # Need at least this many shared (person, box) timestamps before
    # calling proximity "sustained" rather than a one-frame coincidence.
    behaviour_min_common_samples: int = 4
    # Fraction of shared samples that must be within threshold.
    behaviour_sustained_fraction: float = 0.6
    # Total normalized displacement over the window before a box counts
    # as "moving" evidence (never labeled as a specific action).
    behaviour_box_displacement_threshold: float = 0.08
    # Minimum net straight-line displacement required to distinguish true
    # physical translation from random bounding-box jitter in place.
    behaviour_box_min_net_displacement: float = 0.04
    # Minimum trajectory linearity (net_displacement / total_displacement)
    # to filter out stationary jitter oscillations.
    behaviour_box_min_linearity: float = 0.35
    # Minimum consecutive temporal samples required before evaluating velocity.
    behaviour_box_min_samples_for_velocity: int = 3

    # CONFORMANCE — perspective tolerance bands for 2D bbox aspect ratio (width / height).
    # Angled dock camera views project top facets; 1.35 provides perspective tolerance
    # for upright vertical cartons, avoiding false alarms on boxes with slight projection tilt.
    conformance_aspect_ratio_vertical_min: float = 1.35
    conformance_aspect_ratio_horizontal_max: float = 0.70
    conformance_min_box_area: float = 0.005

    # How many of the most-recent cached, sampled frames (ending at the
    # requested timestamp) feed the temporal evidence window — bounded and
    # small on purpose (Phase 5 constraint: reuse the existing sparse
    # sample cache, never reprocess/hold an unbounded history).
    temporal_window_samples: int = 8

    # AGGREGATION — evidence_quality() score cutoffs (Priority 7). A
    # finding below the PROBABLE cutoff is reported as
    # INSUFFICIENT_EVIDENCE, never silently dropped, so the UI can
    # distinguish "checked, not enough evidence" from "not checked".
    aggregation_min_confidence_for_supported: float = 0.6
    aggregation_min_confidence_for_probable: float = 0.3


DEFAULT_RISK_CONFIG = RiskConfig()

# Per-class evidence reliability multiplier — reflects the ACTUAL measured
# pilot fine-tune quality (training/README.md: person mAP50=0.955,
# box mAP50=0.351 real-but-weak, pallet mAP50=0.040 effectively failed),
# not the detector's own per-detection confidence score. This is what lets
# a 0.9-confidence pallet detection still produce a low evidence-quality
# score — the class itself is unreliable regardless of that one score.
# NOT a learned uncertainty model (CLAUDE.md §10).
CLASS_EVIDENCE_RELIABILITY: dict[str, float] = {
    "person": 1.0,
    "box": 0.5,
    "pallet": 0.15,
    "trolley": 0.3,
    "vehicle_bed": 0.3,
}
