from fastapi.testclient import TestClient

from backend.main import APP_NAME, APP_VERSION, app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_meta_returns_app_identity():
    response = client.get("/meta")
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == APP_NAME
    assert body["version"] == APP_VERSION
    assert "phase" in body
