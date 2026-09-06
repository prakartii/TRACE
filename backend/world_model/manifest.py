"""Operational manifest and product metadata catalog (Phase 6).

Maintains a strict, clean separation between:
1. Visual perception ("What did the camera see?")
2. Operational metadata ("What product / SKU is scheduled for this bay?")
3. Inference ("Does the observed state conform to safety rules?")

Perception never fabricates product metadata or assigns SKUs from thin air.
When an operational manifest is configured for a video/camera source, detected
entities are linked to their known product profiles (ProductMetadata) and
calibrated camera zones (EnvironmentalZone). If no manifest is configured, TRACE
cleanly defaults to None, keeping findings honestly at UNSUPPORTED or
INSUFFICIENT_EVIDENCE.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from backend.contracts.models import Fragility, MassClass, ProductMetadata
from backend.lenses.environmental import EnvironmentalZone, ZoneType

# Standard warehouse product catalog (SKU specifications)
PRODUCT_CATALOG: dict[str, ProductMetadata] = {
    "auradine_cupboard": ProductMetadata(
        product_id="auradine_cupboard",
        class_name="cupboard",
        mass_class=MassClass.HEAVY,
        fragility=Fragility.MEDIUM,
        required_orientation="vertical",
        max_stack_height=1,
    ),
    "kd_flatpack_packets": ProductMetadata(
        product_id="kd_flatpack_packets",
        class_name="kd_packet",
        mass_class=MassClass.LIGHT,
        fragility=Fragility.LOW,
        required_orientation="horizontal",
        max_stack_height=5,
    ),
    "heavy_overpack_box": ProductMetadata(
        product_id="heavy_overpack_box",
        class_name="heavy_box",
        mass_class=MassClass.HEAVY,
        fragility=Fragility.MEDIUM,
        required_orientation="vertical",
        max_stack_height=2,
    ),
    "seating_carton": ProductMetadata(
        product_id="seating_carton",
        class_name="seating",
        mass_class=MassClass.MEDIUM,
        fragility=Fragility.MEDIUM,
        required_orientation=None,  # Unconstrained by SKU spec; prevents false positives on standard cartons
        max_stack_height=3,
    ),
    "general_carton": ProductMetadata(
        product_id="general_carton",
        class_name="carton",
        mass_class=MassClass.MEDIUM,
        fragility=Fragility.LOW,
        required_orientation=None,  # Unconstrained standard carton
        max_stack_height=4,
    ),
}


@dataclass(frozen=True)
class OperationalManifest:
    """Scheduled operation details for a specific camera/source."""

    manifest_id: str
    bay_name: str
    product_metadata: list[ProductMetadata] = field(default_factory=list)
    environmental_zones: list[EnvironmentalZone] = field(default_factory=list)
    primary_product_id: Optional[str] = None

    def get_product(self, product_id: Optional[str] = None) -> Optional[ProductMetadata]:
        if not self.product_metadata:
            return None
        if product_id:
            for p in self.product_metadata:
                if p.product_id == product_id:
                    return p
        if self.primary_product_id:
            for p in self.product_metadata:
                if p.product_id == self.primary_product_id:
                    return p
        return self.product_metadata[0]


# Calibrated camera zones for known operational dock camera views
# (normalized [0, 1] coordinates relative to 1280x720 camera frame)
DOCK_09_EDGE_ZONE = EnvironmentalZone(
    zone_id="dock_09_threshold_gap",
    zone_type=ZoneType.DOCK_EDGE,
    polygon=[(0.0, 0.50), (0.45, 0.45), (0.50, 0.85), (0.0, 0.90)],
    severity_multiplier=1.5,
)

DOCK_10_TRUCK_BED_ZONE = EnvironmentalZone(
    zone_id="dock_10_threshold_gap",
    zone_type=ZoneType.DOCK_EDGE,
    polygon=[(0.40, 0.20), (0.85, 0.20), (0.95, 0.75), (0.35, 0.75)],
    severity_multiplier=1.4,
)

# Registry of manifests keyed by source_id or matched by video filename
_MANIFEST_BY_SOURCE_ID: dict[str, OperationalManifest] = {}

# Known challenge video manifest definitions (audited in docs/VIDEO_AUDIT.md)
_CHALLENGE_MANIFESTS: list[tuple[str, OperationalManifest]] = [
    (
        "Dock level, dragging cupboard",
        OperationalManifest(
            manifest_id="manifest_dock_09_cupboard",
            bay_name="Dock 09 inside",
            product_metadata=[PRODUCT_CATALOG["auradine_cupboard"]],
            environmental_zones=[DOCK_09_EDGE_ZONE],
            primary_product_id="auradine_cupboard",
        ),
    ),
    (
        "KD packets dragged, heavy box kept on other packets",
        OperationalManifest(
            manifest_id="manifest_dock_09_kd_packets",
            bay_name="Dock 09 inside",
            product_metadata=[
                PRODUCT_CATALOG["kd_flatpack_packets"],
                PRODUCT_CATALOG["heavy_overpack_box"],
            ],
            environmental_zones=[DOCK_09_EDGE_ZONE],
            primary_product_id="heavy_overpack_box",
        ),
    ),
    (
        "Stepping on cartons, vertical product kept horizontally",
        OperationalManifest(
            manifest_id="manifest_dock_10_cartons",
            bay_name="Dock 10 out 02",
            product_metadata=[PRODUCT_CATALOG["general_carton"]],
            environmental_zones=[DOCK_10_TRUCK_BED_ZONE],
            primary_product_id="general_carton",
        ),
    ),
    (
        "Throwing seating cartons, using strap to hold",
        OperationalManifest(
            manifest_id="manifest_dock_06_seating",
            bay_name="Dock 06 out 01",
            product_metadata=[PRODUCT_CATALOG["seating_carton"]],
            environmental_zones=[],
            primary_product_id="seating_carton",
        ),
    ),
]


def register_manifest(source_id: str, manifest: OperationalManifest) -> None:
    """Associates an operational manifest with a video source ID."""
    _MANIFEST_BY_SOURCE_ID[source_id] = manifest


def get_manifest_for_source(source_id: str, filename: str = "") -> Optional[OperationalManifest]:
    """Retrieves the operational manifest for a source ID or known challenge video.
    Returns None if no manifest is configured for the source (clean unlinked state).
    Dynamically resolves product metadata against PRODUCT_CATALOG so supervisor
    updates propagate immediately without server restart."""
    raw_manifest: Optional[OperationalManifest] = None
    if source_id in _MANIFEST_BY_SOURCE_ID:
        raw_manifest = _MANIFEST_BY_SOURCE_ID[source_id]
    elif filename:
        for prefix, manifest in _CHALLENGE_MANIFESTS:
            if prefix.lower() in filename.lower():
                raw_manifest = manifest
                break

    if raw_manifest is None:
        return None

    # Dynamically resolve latest product metadata from PRODUCT_CATALOG
    updated_products = [
        PRODUCT_CATALOG.get(p.product_id, p)
        for p in raw_manifest.product_metadata
    ]

    return OperationalManifest(
        manifest_id=raw_manifest.manifest_id,
        bay_name=raw_manifest.bay_name,
        product_metadata=updated_products,
        environmental_zones=raw_manifest.environmental_zones,
        primary_product_id=raw_manifest.primary_product_id,
    )
