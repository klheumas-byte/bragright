from datetime import datetime, timezone

import mongomock
import pytest
from werkzeug.security import generate_password_hash

from app import db as db_module
from app import create_app


class TestConfig:
    TESTING = True
    DEBUG = True
    SECRET_KEY = "test-flask-secret-that-is-long-enough"
    MONGO_URI = "mongodb://localhost:27017"
    MONGO_DB_NAME = "bragright_test"
    MONGODB_URI = MONGO_URI
    MONGODB_DATABASE = MONGO_DB_NAME
    APP_ENV = "testing"
    IS_PRODUCTION = False
    FRONTEND_ORIGIN = "http://localhost:5173"
    CORS_ORIGINS = ["http://localhost:5173"]
    ALLOWED_ORIGINS = CORS_ORIGINS
    MATCH_DUPLICATE_WINDOW_MINUTES = 4
    ADMIN_EMAILS = "bootstrap@example.com"
    JWT_ACCESS_SECRET = "test-access-secret-that-is-at-least-thirty-two-characters"
    JWT_ACCESS_TOKEN_MINUTES = 15
    JWT_ISSUER = "bragright-test"
    JWT_AUDIENCE = "bragright-test-api"
    REFRESH_TOKEN_DAYS = 30
    REFRESH_COOKIE_NAME = "bragright_refresh"
    AUTH_COOKIE_SECURE = False
    AUTH_COOKIE_SAMESITE = "Lax"
    AUTH_COOKIE_DOMAIN = None
    INIT_DB_INDEXES_AT_STARTUP = False
    MAX_UPLOAD_SIZE_MB = 5
    MAX_CONTENT_LENGTH = 6 * 1024 * 1024
    MAX_JSON_BODY_SIZE_KB = 256
    UPLOAD_STORAGE_PROVIDER = "local"
    LOG_LEVEL = "WARNING"
    TRUST_PROXY = False


@pytest.fixture()
def app(tmp_path):
    mongo_client = mongomock.MongoClient(tz_aware=True)
    database = mongo_client[TestConfig.MONGO_DB_NAME]
    db_module._mongo_client = mongo_client
    db_module._mongo_db = database
    db_module._mongo_settings = {
        "mongo_uri": TestConfig.MONGO_URI,
        "mongo_db_name": TestConfig.MONGO_DB_NAME,
    }
    db_module.ensure_database_indexes(config=TestConfig.__dict__)

    class RuntimeTestConfig(TestConfig):
        UPLOAD_DIRECTORY = str(tmp_path / "uploads")

    flask_app = create_app(RuntimeTestConfig)
    yield flask_app

    mongo_client.close()
    db_module._mongo_client = None
    db_module._mongo_db = None
    db_module._mongo_settings = None


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def users(app):
    return db_module.get_users_collection(config=app.config)


@pytest.fixture()
def sessions(app):
    return db_module.get_auth_sessions_collection(config=app.config)


@pytest.fixture()
def matches(app):
    return db_module.get_matches_collection(config=app.config)


@pytest.fixture()
def proof_uploads(app):
    return db_module.get_proof_uploads_collection(config=app.config)


@pytest.fixture()
def activity_logs(app):
    return db_module.get_activity_logs_collection(config=app.config)


@pytest.fixture()
def create_user(users):
    def factory(
        email,
        password="correct-horse-battery-staple",
        role="player",
        status="active",
        username=None,
    ):
        now = datetime.now(timezone.utc)
        user_document = {
            "username": username or email.split("@", 1)[0],
            "email": email,
            "password_hash": generate_password_hash(password),
            "role": role,
            "status": status,
            "is_active": status == "active",
            "created_at": now,
            "last_login": None,
            "last_login_at": None,
            "profile_image": None,
            "updated_at": now,
        }
        result = users.insert_one(user_document)
        return users.find_one({"_id": result.inserted_id})

    return factory
