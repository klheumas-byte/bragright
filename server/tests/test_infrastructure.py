from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

import pytest
import mongomock

from app import create_app
from app import db as db_module
from app.services.upload_storage import LocalUploadStorage


PASSWORD = "correct-horse-battery-staple"


def _login(client, email):
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": PASSWORD},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def test_application_starts_with_valid_configuration(app):
    assert app.config["TESTING"] is True
    assert app.config["MONGODB_URI"]


def test_production_startup_fails_when_required_configuration_is_missing():
    class MissingProductionConfig:
        TESTING = True
        DEBUG = False
        APP_ENV = "production"
        IS_PRODUCTION = True
        MONGODB_URI = ""
        MONGODB_DATABASE = ""
        MONGO_URI = ""
        MONGO_DB_NAME = ""
        SECRET_KEY = None
        JWT_ACCESS_SECRET = None
        ALLOWED_ORIGINS = []
        CORS_ORIGINS = []
        FRONTEND_ORIGIN = ""
        AUTH_COOKIE_SAMESITE = "None"
        AUTH_COOKIE_SECURE = True
        UPLOAD_STORAGE_PROVIDER = "local"

    with pytest.raises(RuntimeError, match="Missing required environment variables"):
        create_app(MissingProductionConfig)


def test_database_initialization_reuses_process_client(app):
    first_database = db_module.get_db(config=app.config)
    second_database = db_module.get_db(config=app.config)
    assert first_database is second_database
    assert first_database.client is second_database.client


def test_database_initialization_connects_with_valid_configuration(app, monkeypatch):
    mongo_client = mongomock.MongoClient(tz_aware=True)
    monkeypatch.setattr(db_module, "MongoClient", lambda *args, **kwargs: mongo_client)
    db_module._mongo_client = None
    db_module._mongo_db = None
    database = db_module.init_db(config=app.config)
    assert database.name == app.config["MONGODB_DATABASE"]
    assert db_module.get_db(config=app.config) is database


def test_index_initialization_is_idempotent(app):
    db_module.ensure_database_indexes(config=app.config)
    first_indexes = {
        name: set(collection.index_information())
        for name, collection in (
            ("users", db_module.get_users_collection(config=app.config)),
            ("matches", db_module.get_matches_collection(config=app.config)),
            ("uploads", db_module.get_proof_uploads_collection(config=app.config)),
        )
    }
    db_module.ensure_database_indexes(config=app.config)
    second_indexes = {
        name: set(collection.index_information())
        for name, collection in (
            ("users", db_module.get_users_collection(config=app.config)),
            ("matches", db_module.get_matches_collection(config=app.config)),
            ("uploads", db_module.get_proof_uploads_collection(config=app.config)),
        )
    }
    assert first_indexes == second_indexes


def test_health_is_minimal_and_safe(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json == {"success": True, "data": {"status": "ok"}}


def test_readiness_reports_healthy_database(client, monkeypatch):
    monkeypatch.setattr("app.routes.health.check_database_ready", lambda **_: True)
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json == {"success": True, "data": {"status": "ready"}}


def test_readiness_reports_unavailable_database_without_details(client, monkeypatch):
    def unavailable(**_):
        raise RuntimeError("mongodb://secret-host/private-database")

    monkeypatch.setattr("app.routes.health.check_database_ready", unavailable)
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json["error"]["code"] == "NOT_READY"
    assert "secret-host" not in str(response.json)


def test_oversized_upload_returns_json_413(app, client, create_user):
    create_user("player@example.com", password=PASSWORD)
    headers = _login(client, "player@example.com")
    app.config["MAX_CONTENT_LENGTH"] = 1024
    response = client.post(
        "/api/matches/upload-proof",
        data={"proof_image": (BytesIO(b"\x89PNG\r\n\x1a\n" + b"x" * 2048), "proof.png")},
        headers=headers,
        content_type="multipart/form-data",
    )
    assert response.status_code == 413
    assert response.json["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_invalid_upload_type_is_rejected(client, create_user):
    create_user("player@example.com", password=PASSWORD)
    response = client.post(
        "/api/matches/upload-proof",
        data={"proof_image": (BytesIO(b"not-an-image"), "proof.txt")},
        headers=_login(client, "player@example.com"),
        content_type="multipart/form-data",
    )
    assert response.status_code == 400


def test_local_storage_rejects_path_traversal(tmp_path):
    storage = LocalUploadStorage(tmp_path)
    with pytest.raises(ValueError):
        storage.save("../outside.png", b"content")
    assert not (tmp_path.parent / "outside.png").exists()


def test_authorized_upload_deletion_removes_file_and_metadata(
    app,
    client,
    create_user,
    proof_uploads,
):
    owner = create_user("owner@example.com", password=PASSWORD)
    filename = "b" * 32 + ".png"
    provider_key = f"proofs/{filename}"
    storage = LocalUploadStorage(app.config["UPLOAD_DIRECTORY"])
    storage.save(provider_key, b"\x89PNG\r\n\x1a\n")
    proof_uploads.insert_one(
        {
            "filename": filename,
            "owner_id": str(owner["_id"]),
            "match_id": None,
            "provider": "local",
            "provider_key": provider_key,
            "created_at": datetime.now(timezone.utc),
        }
    )
    response = client.delete(
        f"/api/matches/proof/{filename}",
        headers=_login(client, "owner@example.com"),
    )
    assert response.status_code == 200
    assert proof_uploads.find_one({"filename": filename}) is None
    assert storage.exists(provider_key) is False


def test_api_404_is_json_and_contains_request_id(client):
    response = client.get(
        "/api/not-a-route",
        headers={"X-Request-ID": "controlled-request-id"},
    )
    assert response.status_code == 404
    assert response.is_json
    assert response.json["request_id"] == "controlled-request-id"
    assert response.headers["X-Request-ID"] == "controlled-request-id"


def test_production_error_response_never_exposes_stack_trace(app):
    @app.get("/api/test-controlled-error")
    def controlled_error():
        raise RuntimeError("private stack detail")

    response = app.test_client().get("/api/test-controlled-error")
    assert response.status_code == 500
    assert response.json["error"]["message"] == "Internal server error."
    assert "private stack detail" not in str(response.json)
    assert "traceback" not in str(response.json).lower()


def test_cors_allows_only_configured_origin(client):
    allowed = client.options(
        "/api/auth/login",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    denied = client.options(
        "/api/auth/login",
        headers={
            "Origin": "https://attacker.example",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert allowed.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "Access-Control-Allow-Origin" not in denied.headers


@pytest.mark.parametrize(
    "path",
    [
        "/api/payments/payments?billing_month=2026-07",
        "/api/payments/remittances?billing_month=2026-07",
    ],
)
def test_cors_preflight_does_not_validate_follow_up_query_parameters(client, path):
    response = client.options(
        path,
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "authorization" in response.headers["Access-Control-Allow-Headers"].lower()


def test_render_spa_routes_do_not_rewrite_api_to_index():
    render_config = (
        Path(__file__).resolve().parents[2] / "render.yaml"
    ).read_text(encoding="utf-8")
    api_rule = render_config.index('source: "/api/*"')
    fallback_rule = render_config.index('source: "/*"')
    assert api_rule < fallback_rule
    assert 'destination: "/api-not-found.json"' in render_config[api_rule:fallback_rule]
    assert 'destination: "/index.html"' in render_config[fallback_rule:]
    assert "Cache-Control" in render_config
    assert "no-cache, no-store, must-revalidate" in render_config
