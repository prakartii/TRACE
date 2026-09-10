"""Full end-to-end video ingestion pipeline (CLAUDE.md critical-pass Feature 3).

Wires the SAME per-frame reasoning pipeline `GET /api/videos/{id}/findings`
already uses (perception -> world model -> four risk lenses -> custom rules
-> planner -> `persist_findings`) into a bulk sweep over an entire video, so a
newly uploaded clip gets real, evidence-grounded incidents without a
supervisor having to manually scrub every frame in Live View first.

``analyze_frame`` below is the single source of truth for "what happens for
one sampled frame" — backend/api/findings.py's on-demand endpoint and
``run_video_ingestion``'s bulk sweep both call it. There is no second
detector and no second risk model here.
"""

from __future__ import annotations

import logging
import sqlite3
import time
from typing import Optional

from backend.contracts.models import RiskEvent
from backend.db.app_settings import get_setting, set_setting
from backend.db.db import ensure_schema_migrations, get_connection
from backend.db.events import persist_findings
from backend.behaviour.lens import evaluate_behaviour
from backend.lenses.conformance import STANDARD_CONFORMANCE_RULES, evaluate_conformance
from backend.lenses.environmental import CONFIGURED_ZONES, evaluate_environmental
from backend.lenses.structural import evaluate_structural
from backend.planner.actions import plan_action
from backend.risk.config import DEFAULT_RISK_CONFIG
from backend.rules.engine import apply_custom_rules_to_findings
from backend.video.registry import VideoRecord, VideoRegistry
from backend.world_model.manifest import get_manifest_for_source
from backend.world_model.scene_graph import WorldModel

logger = logging.getLogger("trace.video.ingest")

# Analyzing every cached sample on a long clip could take minutes under CPU
# inference. The challenge videos are all short, so this cap only bounds
# runtime for arbitrary supervisor uploads — it never fabricates coverage,
# it just spaces the real samples evenly across the clip.
MAX_INGEST_SAMPLES = 90


def _status_key(canonical_id: str) -> str:
    return f"video_ingest_status:{canonical_id}"


def get_ingestion_status(conn: sqlite3.Connection, video_id: str) -> Optional[dict]:
    """Last known ingestion status for ``video_id`` (or its canonical id),
    or ``None`` if this video has never been analyzed."""
    return get_setting(conn, _status_key(video_id))


def analyze_frame(
    *,
    video_id: str,
    frame_result,
    window: list,
    record: VideoRecord,
    world_model: WorldModel,
    db: sqlite3.Connection,
    persist: bool = True,
) -> list[RiskEvent]:
    """Runs the four risk lenses + custom rules + planner for one already
    -sampled frame and (by default) persists the result through the existing
    dedup path. Exactly the logic `GET /api/videos/{id}/findings` runs per
    timestamp — factored out so bulk ingestion is never a second, divergent
    pipeline (CLAUDE.md: "do not create a second perception/risk pipeline")."""
    manifest = get_manifest_for_source(video_id, record.filename)
    product_metadata_by_id = (
        {p.product_id: p for p in manifest.product_metadata} if manifest else {}
    )
    default_product_id = manifest.primary_product_id if manifest else None
    zones = manifest.environmental_zones if manifest else CONFIGURED_ZONES

    snapshot = world_model.build_snapshot(
        frame_result.entities,
        frame_width=record.metadata.width,
        frame_height=record.metadata.height,
        timestamp=frame_result.timestamp,
        default_product_id=default_product_id,
        compute_aspect_orientation=True,
    )
    entity_confidence = {e.id: e.confidence for e in frame_result.entities}

    findings: list[RiskEvent] = []
    findings.extend(
        evaluate_behaviour(
            window,
            frame_width=record.metadata.width,
            frame_height=record.metadata.height,
            timestamp=frame_result.timestamp,
            product_metadata_by_id=product_metadata_by_id,
            default_product_id=default_product_id,
        )
    )
    findings.extend(
        evaluate_structural(
            snapshot,
            entity_confidence=entity_confidence,
            product_metadata_by_id=product_metadata_by_id,
        )
    )
    findings.extend(
        evaluate_conformance(
            snapshot.nodes,
            product_metadata_by_id=product_metadata_by_id,
            timestamp=frame_result.timestamp,
            rules=STANDARD_CONFORMANCE_RULES,
        )
    )
    findings.extend(
        evaluate_environmental(
            snapshot.nodes,
            timestamp=frame_result.timestamp,
            zones=zones,
        )
    )

    apply_custom_rules_to_findings(findings, db)

    for f in findings:
        if f.planner_recommendation is None:
            f.planner_recommendation = plan_action(
                f.scenario, f.status, f.confidence, evidence=f.evidence, limitations=f.limitations,
            )

    if persist and findings:
        canonical_id = record.duplicate_of or record.id
        try:
            persist_findings(
                findings=findings,
                video_id=video_id,
                canonical_id=canonical_id,
                timestamp=frame_result.timestamp,
                conn=db,
            )
        except Exception:
            logger.warning("persist_findings failed for %s @ %.2fs", video_id, frame_result.timestamp, exc_info=True)

    return findings


def run_video_ingestion(video_id: str, *, model: str = "pilot", registry: Optional[VideoRegistry] = None) -> dict:
    """Runs the full ingestion sweep for ``video_id`` and returns the status
    dict that also gets persisted to ``app_settings`` (survives refresh /
    server restart, keyed by the video's canonical id and its own id).

    Safe to call more than once for the same file: `persist_findings`
    dedups on (canonical_id, scenario, timestamp, entity), so re-ingesting
    updates existing rows rather than duplicating incidents.
    """
    from backend.api.perception import get_cached_results, get_pipeline_registry
    from backend.api.videos import get_registry as _get_default_registry
    from backend.intervention.engine import intervention_engine

    registry = registry or _get_default_registry()
    record = registry.get(video_id)
    conn = get_connection()
    try:
        ensure_schema_migrations(conn)

        if record is None:
            status = {"status": "failed", "video_id": video_id, "error": f"Unknown video id '{video_id}'"}
            set_setting(conn, _status_key(video_id), status)
            return status

        canonical_id = record.duplicate_of or record.id
        started = time.time()

        def _write(payload: dict) -> dict:
            set_setting(conn, _status_key(canonical_id), payload)
            if video_id != canonical_id:
                set_setting(conn, _status_key(video_id), payload)
            return payload

        _write({
            "status": "processing",
            "video_id": video_id,
            "canonical_id": canonical_id,
            "filename": record.filename,
            "started_at": started,
        })

        pipelines = get_pipeline_registry()
        pipeline = pipelines.get(model) or pipelines["stock"]

        try:
            results = get_cached_results(canonical_id, registry, pipeline, model)
        except Exception as exc:
            return _write({
                "status": "failed",
                "video_id": video_id,
                "canonical_id": canonical_id,
                "filename": record.filename,
                "error": f"Perception failed: {exc}",
                "started_at": started,
                "completed_at": time.time(),
            })

        if not results:
            return _write({
                "status": "complete",
                "video_id": video_id,
                "canonical_id": canonical_id,
                "filename": record.filename,
                "samples_analyzed": 0,
                "events_found": 0,
                "scenarios": [],
                "message": "No decodable frames were sampled from this video.",
                "started_at": started,
                "completed_at": time.time(),
            })

        step = max(1, len(results) // MAX_INGEST_SAMPLES)
        sample_indices = list(range(0, len(results), step))

        world_model = WorldModel()
        all_findings: list[RiskEvent] = []
        for idx in sample_indices:
            frame_result = results[idx]
            window = results[max(0, idx - DEFAULT_RISK_CONFIG.temporal_window_samples + 1): idx + 1]
            findings = analyze_frame(
                video_id=canonical_id,
                frame_result=frame_result,
                window=window,
                record=record,
                world_model=world_model,
                db=conn,
                persist=True,
            )
            all_findings.extend(findings)

        # Only evidence-backed findings become part of the supervisor-facing
        # "what TRACE found" summary. Many raw candidate findings are
        # UNSUPPORTED/INSUFFICIENT_EVIDENCE by design (CLAUDE.md honesty
        # rule) and must not be presented as detected scenarios.
        scenario_counts: dict[str, dict] = {}
        for f in all_findings:
            status_str = f.status.value if hasattr(f.status, "value") else str(f.status)
            if status_str not in ("supported", "probable"):
                continue
            skey = f.scenario or "unspecified_hazard"
            band_str = f.band.value if hasattr(f.band, "value") else str(f.band)
            entry = scenario_counts.setdefault(skey, {
                "scenario": skey,
                "count": 0,
                "first_timestamp": f.timestamp,
                "band": band_str,
                "max_score": f.score or 0.0,
                "event_ids": [],
            })
            entry["count"] += 1
            entry["first_timestamp"] = min(entry["first_timestamp"], f.timestamp)
            if f.event_id:
                entry["event_ids"].append(f.event_id)
            if (f.score or 0.0) > entry["max_score"]:
                entry["max_score"] = f.score or 0.0
                entry["band"] = band_str

        scenarios = sorted(scenario_counts.values(), key=lambda s: -s["max_score"])

        try:
            intervention_engine.seed_active_from_db(video_id=canonical_id, conn=conn)
        except Exception:
            logger.warning("Intervention seeding failed for %s", canonical_id, exc_info=True)

        message = (
            f"{len(scenarios)} supported safety scenario(s) detected."
            if scenarios else "No supported safety scenario detected in this video."
        )

        return _write({
            "status": "complete",
            "video_id": video_id,
            "canonical_id": canonical_id,
            "filename": record.filename,
            "samples_analyzed": len(sample_indices),
            "events_found": sum(s["count"] for s in scenarios),
            "scenarios": scenarios,
            "message": message,
            "started_at": started,
            "completed_at": time.time(),
            "model": model,
        })
    except Exception as exc:
        logger.exception("Video ingestion failed for %s", video_id)
        status = {"status": "failed", "video_id": video_id, "error": str(exc)}
        try:
            set_setting(conn, _status_key(video_id), status)
        except Exception:
            pass
        return status
    finally:
        conn.close()
