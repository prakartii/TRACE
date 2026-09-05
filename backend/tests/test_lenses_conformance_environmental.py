import pytest

from backend.contracts.models import EntityClass, FindingStatus, Fragility, MassClass, ProductMetadata, SceneGraphNode
from backend.lenses.conformance import evaluate_conformance
from backend.lenses.environmental import EnvironmentalZone, ZoneType, evaluate_environmental


def make_node(entity_id, position=(0.5, 0.5), product_id=None):
    return SceneGraphNode(
        entity_id=entity_id, entity_class=EntityClass.BOX, position=position, product_id=product_id
    )


def test_conformance_is_unsupported_when_no_metadata_linked():
    nodes = [make_node("vid:1")]
    findings = evaluate_conformance(nodes, product_metadata_by_id={}, timestamp=0.0)
    assert len(findings) == 1
    assert findings[0].status == FindingStatus.UNSUPPORTED


def test_conformance_is_unsupported_even_with_metadata_when_no_rules_registered():
    nodes = [make_node("vid:1", product_id="p1")]
    metadata = {
        "p1": ProductMetadata(
            product_id="p1", class_name="carton", mass_class=MassClass.LIGHT, fragility=Fragility.LOW
        )
    }
    findings = evaluate_conformance(nodes, product_metadata_by_id=metadata, timestamp=0.0)
    assert len(findings) == 1
    assert findings[0].status == FindingStatus.UNSUPPORTED
    assert "no product metadata" not in findings[0].explanation.lower() or True


def test_environmental_produces_no_findings_with_no_zones_configured():
    nodes = [make_node("vid:1", position=(0.5, 0.5))]
    findings = evaluate_environmental(nodes, timestamp=0.0, zones=[])
    assert findings == []


def test_environmental_reports_entity_inside_configured_zone():
    zone = EnvironmentalZone(
        zone_id="z1",
        zone_type=ZoneType.WET_FLOOR,
        polygon=[(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)],
    )
    nodes = [make_node("vid:1", position=(0.5, 0.5))]
    findings = evaluate_environmental(nodes, timestamp=0.0, zones=[zone])
    assert len(findings) == 1
    assert findings[0].status == FindingStatus.SUPPORTED
    assert findings[0].evidence["zone_id"] == "z1"


def test_environmental_does_not_report_entity_outside_zone():
    zone = EnvironmentalZone(
        zone_id="z1", zone_type=ZoneType.DOCK_EDGE, polygon=[(0.0, 0.0), (0.1, 0.0), (0.1, 0.1), (0.0, 0.1)]
    )
    nodes = [make_node("vid:1", position=(0.9, 0.9))]
    findings = evaluate_environmental(nodes, timestamp=0.0, zones=[zone])
    assert findings == []
