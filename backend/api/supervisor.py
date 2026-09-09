"""REST endpoints for Supervisor Operational Configuration (Phase 7B).

Provides supervisor CRUD and inspection APIs for:
1. Product Metadata Catalog (SKU mass classes, orientations, stack limits)
2. Calibrated Environmental Zones (dock edges, wet floor polygons)
3. Operational Manifests (camera/bay to SKU assignments)

Validates all operational metadata to ensure invalid parameters never silently
enter perception, world model, or safe action planning logic.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.contracts.models import (
    EnvironmentalZoneConfig,
    Fragility,
    ManifestAssignmentRequest,
    MassClass,
    ProductMetadata,
    ProductMetadataCreate,
)
from backend.lenses.environmental import (
    CONFIGURED_ZONES,
    EnvironmentalZone,
    ZoneType,
)
from backend.world_model.manifest import (
    PRODUCT_CATALOG,
    OperationalManifest,
    _CHALLENGE_MANIFESTS,
    _MANIFEST_BY_SOURCE_ID,
    get_manifest_for_source,
    register_manifest,
)

router = APIRouter(prefix="/api/config", tags=["supervisor_configuration"])

# Dynamic zone registry initialized with default configured zones
_ZONE_REGISTRY: dict[str, EnvironmentalZone] = {
    z.zone_id: z for z in CONFIGURED_ZONES
}


# ==============================================================================
# Product Metadata Catalog Endpoints
# ==============================================================================

@router.get("/products", response_model=list[ProductMetadata])
def list_products() -> list[ProductMetadata]:
    """Returns all SKU specifications currently configured in the product catalog."""
    return list(PRODUCT_CATALOG.values())


@router.get("/products/{product_id}", response_model=ProductMetadata)
def get_product(product_id: str) -> ProductMetadata:
    if product_id not in PRODUCT_CATALOG:
        raise HTTPException(status_code=404, detail=f"Product '{product_id}' not found.")
    return PRODUCT_CATALOG[product_id]


@router.post("/products", response_model=ProductMetadata)
def create_or_update_product(payload: ProductMetadataCreate) -> ProductMetadata:
    """Creates or updates a product in the catalog with strict validation."""
    # Validate required orientation
    if payload.required_orientation:
        normalized_ori = payload.required_orientation.strip().lower()
        if normalized_ori not in ("vertical", "horizontal"):
            raise HTTPException(
                status_code=422,
                detail=f"Invalid required_orientation '{payload.required_orientation}'. Must be 'vertical' or 'horizontal'.",
            )
    else:
        normalized_ori = None

    if payload.max_stack_height is not None and payload.max_stack_height < 1:
        raise HTTPException(
            status_code=422,
            detail="max_stack_height must be greater than or equal to 1.",
        )

    product = ProductMetadata(
        product_id=payload.product_id,
        class_name=payload.class_name,
        mass_class=payload.mass_class,
        fragility=payload.fragility,
        required_orientation=normalized_ori,
        max_stack_height=payload.max_stack_height,
    )
    PRODUCT_CATALOG[payload.product_id] = product
    return product


@router.delete("/products/{product_id}")
def delete_product(product_id: str) -> dict:
    """Deletes an SKU from the product catalog."""
    if product_id not in PRODUCT_CATALOG:
        raise HTTPException(status_code=404, detail=f"Product '{product_id}' not found.")
    del PRODUCT_CATALOG[product_id]
    return {"status": "deleted", "product_id": product_id}


# ==============================================================================
# Environmental Zones Endpoints
# ==============================================================================

@router.get("/zones", response_model=list[EnvironmentalZoneConfig])
def list_zones() -> list[EnvironmentalZoneConfig]:
    """Returns every calibrated environmental zone actually in force.

    That includes the zones carried by the built-in challenge manifests — those
    are what `backend/api/findings.py` hands to the environmental lens, so a
    supervisor must be able to see and audit them (CLAUDE.md §22). Previously
    this listed only operator-created zones, so the screen showed "0" while
    dock-edge and wet-floor alerts were actively being raised.
    """
    zones: dict[str, EnvironmentalZone] = {}
    for _prefix, manifest in _CHALLENGE_MANIFESTS:
        for z in manifest.environmental_zones:
            zones.setdefault(z.zone_id, z)
    # Operator-configured zones win on id collision.
    zones.update(_ZONE_REGISTRY)
    return [
        EnvironmentalZoneConfig(
            zone_id=z.zone_id,
            zone_type=z.zone_type.value,
            polygon=z.polygon,
            severity_multiplier=z.severity_multiplier,
        )
        for z in zones.values()
    ]


@router.post("/zones", response_model=EnvironmentalZoneConfig)
def create_or_update_zone(payload: EnvironmentalZoneConfig) -> EnvironmentalZoneConfig:
    """Configures a calibrated camera zone with polygon validation."""
    if len(payload.polygon) < 3:
        raise HTTPException(
            status_code=422,
            detail="Zone polygon must contain at least 3 vertices.",
        )

    for idx, (x, y) in enumerate(payload.polygon):
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise HTTPException(
                status_code=422,
                detail=f"Vertex #{idx} ({x}, {y}) outside normalized [0, 1] range.",
            )

    try:
        zt = ZoneType(payload.zone_type)
    except ValueError:
        valid = [e.value for e in ZoneType]
        raise HTTPException(
            status_code=422,
            detail=f"Invalid zone_type '{payload.zone_type}'. Allowed: {valid}",
        )

    zone = EnvironmentalZone(
        zone_id=payload.zone_id,
        zone_type=zt,
        polygon=payload.polygon,
        severity_multiplier=payload.severity_multiplier,
    )
    _ZONE_REGISTRY[payload.zone_id] = zone
    return payload


@router.delete("/zones/{zone_id}")
def delete_zone(zone_id: str) -> dict:
    """Deletes a calibrated environmental zone."""
    if zone_id not in _ZONE_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found.")
    del _ZONE_REGISTRY[zone_id]
    return {"status": "deleted", "zone_id": zone_id}


# ==============================================================================
# Operational Manifest Endpoints
# ==============================================================================

def _resolve_manifest(source_id: str) -> Optional[OperationalManifest]:
    """Resolves the manifest in force for a source, built-in ones included.

    Built-in challenge manifests are matched on the source's *filename*, so
    `get_manifest_for_source(source_id)` alone never finds them. Both the list
    and the detail endpoint must look the filename up the same way — when only
    the list did, every one of the eight sources it reported 404'd on drill-in.
    """
    m = get_manifest_for_source(source_id)
    if m is not None:
        return m
    try:
        from backend.video.registry import VideoRegistry

        record = VideoRegistry().get(source_id)
    except Exception:
        return None
    if record is None:
        return None
    return get_manifest_for_source(record.id, record.filename)


@router.get("/manifests", response_model=list[dict])
def list_manifests() -> list[dict]:
    """Lists every operational manifest in force, keyed to its camera source.

    Built-in challenge manifests are resolved by filename at request time
    (`get_manifest_for_source`), so listing only the operator-registered dict
    reported "0" while all eight sources were in fact running a manifest with
    its product metadata and hazard zones. Both are listed now, tagged by origin.
    """
    results = []
    seen: set[str] = set()

    try:
        from backend.video.registry import VideoRegistry

        for record in VideoRegistry().list_videos():
            m = _resolve_manifest(record.id)
            if m is None:
                continue
            seen.add(record.id)
            results.append({
                "source_id": record.id,
                "source_filename": record.filename,
                "manifest_id": m.manifest_id,
                "bay_name": m.bay_name,
                "primary_product_id": m.primary_product_id,
                "product_count": len(m.product_metadata),
                "zone_count": len(m.environmental_zones),
                "zone_ids": [z.zone_id for z in m.environmental_zones],
                "origin": "operator" if record.id in _MANIFEST_BY_SOURCE_ID else "built-in",
            })
    except Exception:
        # A registry problem must not blank the operator-registered manifests.
        pass

    for sid, m in _MANIFEST_BY_SOURCE_ID.items():
        if sid in seen:
            continue
        results.append({
            "source_id": sid,
            "source_filename": None,
            "manifest_id": m.manifest_id,
            "bay_name": m.bay_name,
            "primary_product_id": m.primary_product_id,
            "product_count": len(m.product_metadata),
            "zone_count": len(m.environmental_zones),
            "zone_ids": [z.zone_id for z in m.environmental_zones],
            "origin": "operator",
        })
    return results


@router.get("/manifests/{source_id}")
def get_source_manifest(source_id: str) -> dict:
    manifest = _resolve_manifest(source_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail=f"No manifest configured for source '{source_id}'.")
    return {
        "manifest_id": manifest.manifest_id,
        "bay_name": manifest.bay_name,
        "primary_product_id": manifest.primary_product_id,
        "products": manifest.product_metadata,
        "zones": [
            {
                "zone_id": z.zone_id,
                "zone_type": z.zone_type.value,
                "polygon": z.polygon,
                "severity_multiplier": z.severity_multiplier,
            }
            for z in manifest.environmental_zones
        ],
    }


@router.post("/manifests")
def assign_manifest(payload: ManifestAssignmentRequest) -> dict:
    """Associates an operational manifest with a camera/video source."""
    products: list[ProductMetadata] = []
    for pid in payload.product_ids:
        if pid not in PRODUCT_CATALOG:
            raise HTTPException(status_code=422, detail=f"Unknown product '{pid}' in assignment.")
        products.append(PRODUCT_CATALOG[pid])

    zones: list[EnvironmentalZone] = []
    for zid in payload.zone_ids:
        if zid not in _ZONE_REGISTRY:
            raise HTTPException(status_code=422, detail=f"Unknown zone '{zid}' in assignment.")
        zones.append(_ZONE_REGISTRY[zid])

    manifest = OperationalManifest(
        manifest_id=payload.manifest_id,
        bay_name=payload.bay_name,
        product_metadata=products,
        environmental_zones=zones,
        primary_product_id=payload.primary_product_id,
    )
    register_manifest(payload.source_id, manifest)
    return {
        "status": "assigned",
        "source_id": payload.source_id,
        "manifest_id": payload.manifest_id,
        "products_linked": len(products),
        "zones_linked": len(zones),
    }
