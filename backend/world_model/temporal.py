"""Temporal evidence over a sequence of cached PerceptionFrameResults
(Phase 5). Reuses Phase 3's track identity (Entity.id) directly — no
second tracker, no new identity system. Reuses Phase 4's normalized
image-space geometry (backend/world_model/geometry.py) — no metric
units. All quantities here are "normalized image-space per second",
never real velocity — there is no camera calibration (docs/WORLD_MODEL.md).
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.contracts.models import BoundingBox, EntityClass, PerceptionFrameResult
from backend.world_model.geometry import bbox_center, bbox_is_degenerate, euclidean_distance, normalize_bbox


@dataclass(frozen=True)
class TrackSample:
    timestamp: float
    position: tuple[float, float]  # normalized [0,1] center
    confidence: float
    footprint: BoundingBox | None = None
    tracking_status: str = "TRACKED"


@dataclass(frozen=True)
class TrackHistory:
    """One track's (Entity.id's) samples across a cached run, in
    chronological order. May have gaps — samples are only recorded for
    timestamps where that exact track appeared."""

    entity_id: str
    entity_class: EntityClass
    samples: list[TrackSample]
    lost_intervals: tuple[tuple[float, float], ...] = ()
    reacquisitions: int = 0

    @property
    def first(self) -> TrackSample:
        return self.samples[0]

    @property
    def last(self) -> TrackSample:
        return self.samples[-1]

    def get_state_at(self, timestamp: float, tolerance: float = 0.08) -> str:
        """Determines tracking state at a given timestamp: TRACKED, REACQUIRED,
        TEMPORARILY_LOST, or INACTIVE. Never fabricates missing detections."""
        for s in self.samples:
            if abs(s.timestamp - timestamp) <= tolerance:
                return s.tracking_status
        for start, end in self.lost_intervals:
            if start <= timestamp <= end:
                return "TEMPORARILY_LOST"
        return "INACTIVE"


def build_track_histories(
    frame_results: list[PerceptionFrameResult], frame_width: int, frame_height: int
) -> dict[str, TrackHistory]:
    """Groups entities by Entity.id (already a stable per-run track
    identity — see backend/perception/adapter.py) across the given
    sampled frames. Degenerate bboxes are skipped, same as
    entity_to_scene_node — never fabricate a position for one."""
    samples_by_id: dict[str, list[TrackSample]] = {}
    class_by_id: dict[str, EntityClass] = {}

    all_timestamps = sorted(set(fr.timestamp for fr in frame_results))
    typical_dt = 0.33
    if len(all_timestamps) >= 2:
        dts = [t2 - t1 for t1, t2 in zip(all_timestamps, all_timestamps[1:]) if t2 - t1 > 1e-4]
        if dts:
            typical_dt = sum(dts) / len(dts)

    for frame_result in frame_results:
        for entity in frame_result.entities:
            if bbox_is_degenerate(entity.bbox):
                continue
            normalized = normalize_bbox(entity.bbox, frame_width, frame_height)
            position = bbox_center(normalized)
            status = getattr(entity, "tracking_status", "TRACKED")
            samples_by_id.setdefault(entity.id, []).append(
                TrackSample(
                    timestamp=frame_result.timestamp,
                    position=position,
                    confidence=entity.confidence,
                    footprint=normalized,
                    tracking_status=status,
                )
            )
            class_by_id[entity.id] = entity.entity_class

    histories: dict[str, TrackHistory] = {}
    for entity_id, samples in samples_by_id.items():
        sorted_samples = sorted(samples, key=lambda s: s.timestamp)
        lost_intervals: list[tuple[float, float]] = []
        reacquisitions = 0
        for s_prev, s_curr in zip(sorted_samples, sorted_samples[1:]):
            dt = s_curr.timestamp - s_prev.timestamp
            if dt > typical_dt * 1.6:
                lost_intervals.append((s_prev.timestamp, s_curr.timestamp))
                reacquisitions += 1
            elif s_curr.tracking_status == "REACQUIRED":
                reacquisitions += 1

        histories[entity_id] = TrackHistory(
            entity_id=entity_id,
            entity_class=class_by_id[entity_id],
            samples=sorted_samples,
            lost_intervals=tuple(lost_intervals),
            reacquisitions=reacquisitions,
        )
    return histories


def total_displacement(history: TrackHistory) -> float:
    """Sum of normalized center-to-center distances between consecutive
    samples — "distance traveled", not straight-line."""
    if len(history.samples) < 2:
        return 0.0
    return sum(
        euclidean_distance(a.position, b.position)
        for a, b in zip(history.samples, history.samples[1:])
    )


def net_displacement(history: TrackHistory) -> float:
    """Straight-line normalized distance from first to last sample."""
    if len(history.samples) < 2:
        return 0.0
    return euclidean_distance(history.first.position, history.last.position)


def average_speed(history: TrackHistory) -> float | None:
    """Normalized image-space displacement per second — NEVER metres/sec
    (no camera calibration exists). None if fewer than 2 samples or zero
    time elapsed."""
    if len(history.samples) < 2:
        return None
    duration = history.last.timestamp - history.first.timestamp
    if duration <= 0:
        return None
    return total_displacement(history) / duration


def net_speed(history: TrackHistory) -> float | None:
    """Normalized straight-line image-space speed (net_displacement / duration).
    Filters out high-frequency bounding box jitter spikes that artificially
    inflate total_displacement / duration. Returns None if < 2 samples or duration <= 0."""
    if len(history.samples) < 2:
        return None
    duration = history.last.timestamp - history.first.timestamp
    if duration <= 0:
        return None
    return net_displacement(history) / duration


def trajectory_linearity(history: TrackHistory) -> float:
    """Ratio of net straight-line displacement to total cumulative path displacement.
    Returns 0.0 if fewer than 2 samples or total displacement is near zero.
    Values near 1.0 indicate straight-line translation; values < 0.35 indicate
    jitter oscillations or random Brownian motion around a stationary point."""
    tot = total_displacement(history)
    if tot <= 1e-6:
        return 0.0
    return min(1.0, net_displacement(history) / tot)


def direction(history: TrackHistory) -> tuple[float, float] | None:
    """Unit vector of net movement (first -> last sample), or None if the
    track didn't move enough to have a meaningful direction (or has < 2
    samples)."""
    d = net_displacement(history)
    if d <= 1e-9:
        return None
    dx = history.last.position[0] - history.first.position[0]
    dy = history.last.position[1] - history.first.position[1]
    return (dx / d, dy / d)


def track_continuity_ratio(history: TrackHistory, expected_sample_count: int) -> float:
    """Fraction of the expected sample count actually observed for this
    track — a proxy for how continuously it was tracked over the window,
    not a physical measurement. 0.0 if expected_sample_count <= 0."""
    if expected_sample_count <= 0:
        return 0.0
    return min(1.0, len(history.samples) / expected_sample_count)


def sustained_proximity_fraction(
    history_a: TrackHistory, history_b: TrackHistory, threshold: float
) -> float:
    """Fraction of timestamps common to both histories where their
    normalized center distance is <= threshold. 0.0 if the two tracks
    never overlap in time at all (a real, honest "no evidence" case, not
    an error)."""
    positions_b = {s.timestamp: s.position for s in history_b.samples}
    common = [(a.position, positions_b[a.timestamp]) for a in history_a.samples if a.timestamp in positions_b]
    if not common:
        return 0.0
    close = sum(1 for pos_a, pos_b in common if euclidean_distance(pos_a, pos_b) <= threshold)
    return close / len(common)


def common_sample_count(history_a: TrackHistory, history_b: TrackHistory) -> int:
    """How many timestamps the two histories actually share — the
    denominator sustained_proximity_fraction's confidence should be
    weighed against (2 shared samples is much weaker evidence than 20)."""
    timestamps_b = {s.timestamp for s in history_b.samples}
    return sum(1 for a in history_a.samples if a.timestamp in timestamps_b)
