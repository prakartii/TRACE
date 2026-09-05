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
