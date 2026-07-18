import os
from pathlib import Path

from dotenv import dotenv_values

from .db import load_server_env


BASE_DIR = Path(__file__).resolve().parents[1]
load_server_env()
ENV_VALUES = dotenv_values(BASE_DIR / ".env") if (BASE_DIR / ".env").exists() else {}


def _get_setting(name, default=None):
    return os.getenv(name) or ENV_VALUES.get(name) or default


def _get_list_setting(name, default=""):
    raw_value = _get_setting(name, default)
    return [item.strip() for item in str(raw_value or "").split(",") if item.strip()]


def _get_bool_setting(name, default=False):
    raw_value = _get_setting(name)
    if raw_value is None:
        return bool(default)
    return str(raw_value).strip().lower() in {"1", "true", "yes", "on"}


def _get_int_setting(name, default, *, minimum=None, maximum=None):
    raw_value = _get_setting(name, str(default))
    try:
        value = int(raw_value)
    except (TypeError, ValueError) as error:
        raise RuntimeError(f"{name} must be a whole number.") from error
    if minimum is not None and value < minimum:
        raise RuntimeError(f"{name} must be at least {minimum}.")
    if maximum is not None and value > maximum:
        raise RuntimeError(f"{name} must be at most {maximum}.")
    return value


class Config:
    APP_ENV = str(
        _get_setting("APP_ENV", _get_setting("FLASK_ENV", "development"))
    ).strip().lower()
    IS_PRODUCTION = APP_ENV == "production"
    DEBUG = _get_bool_setting("FLASK_DEBUG", not IS_PRODUCTION)
    HOST = _get_setting("FLASK_HOST", "0.0.0.0")
    PORT = _get_int_setting("PORT", _get_setting("FLASK_PORT", "5000"), minimum=1, maximum=65535)
    SECRET_KEY = _get_setting("SECRET_KEY") or (
        "development-only-bragright-flask-secret"
        if not IS_PRODUCTION
        else None
    )
    MONGODB_URI = _get_setting("MONGODB_URI", _get_setting("MONGO_URI"))
    MONGODB_DATABASE = _get_setting(
        "MONGODB_DATABASE",
        _get_setting("MONGO_DB_NAME"),
    )
    # Compatibility aliases for existing application code and local .env files.
    MONGO_URI = MONGODB_URI
    MONGO_DB_NAME = MONGODB_DATABASE
    FRONTEND_ORIGIN = _get_setting(
        "FRONTEND_ORIGIN",
        "http://localhost:5173" if not IS_PRODUCTION else "",
    )
    ALLOWED_ORIGINS = _get_list_setting(
        "ALLOWED_ORIGINS",
        FRONTEND_ORIGIN,
    )
    CORS_ORIGINS = ALLOWED_ORIGINS
    MATCH_DUPLICATE_WINDOW_MINUTES = _get_int_setting(
        "MATCH_DUPLICATE_WINDOW_MINUTES",
        4,
        minimum=1,
        maximum=60,
    )
    ADMIN_EMAILS = _get_setting("ADMIN_EMAILS", "")
    JWT_ACCESS_SECRET = _get_setting("JWT_ACCESS_SECRET") or (
        "development-only-bragright-access-secret-change-before-production"
        if not IS_PRODUCTION
        else None
    )
    JWT_ACCESS_TOKEN_MINUTES = _get_int_setting(
        "JWT_ACCESS_TOKEN_MINUTES",
        15,
        minimum=1,
        maximum=1440,
    )
    JWT_ISSUER = _get_setting("JWT_ISSUER", "bragright")
    JWT_AUDIENCE = _get_setting("JWT_AUDIENCE", "bragright-api")
    REFRESH_TOKEN_DAYS = _get_int_setting(
        "REFRESH_TOKEN_DAYS",
        30,
        minimum=1,
        maximum=365,
    )
    REFRESH_COOKIE_NAME = _get_setting("REFRESH_COOKIE_NAME", "bragright_refresh")
    AUTH_COOKIE_SECURE = _get_bool_setting("AUTH_COOKIE_SECURE", IS_PRODUCTION)
    AUTH_COOKIE_SAMESITE = _get_setting(
        "AUTH_COOKIE_SAMESITE",
        "None" if IS_PRODUCTION else "Lax",
    )
    AUTH_COOKIE_DOMAIN = _get_setting("AUTH_COOKIE_DOMAIN")
    INIT_DB_INDEXES_AT_STARTUP = _get_bool_setting(
        "INIT_DB_INDEXES_AT_STARTUP",
        False,
    )
    MONGODB_SERVER_SELECTION_TIMEOUT_MS = _get_int_setting(
        "MONGODB_SERVER_SELECTION_TIMEOUT_MS",
        5000,
        minimum=1000,
        maximum=30000,
    )
    MONGODB_CONNECT_TIMEOUT_MS = _get_int_setting(
        "MONGODB_CONNECT_TIMEOUT_MS",
        5000,
        minimum=1000,
        maximum=30000,
    )
    MONGODB_SOCKET_TIMEOUT_MS = _get_int_setting(
        "MONGODB_SOCKET_TIMEOUT_MS",
        10000,
        minimum=1000,
        maximum=60000,
    )
    MAX_UPLOAD_SIZE_MB = _get_int_setting(
        "MAX_UPLOAD_SIZE_MB",
        5,
        minimum=1,
        maximum=25,
    )
    MAX_CONTENT_LENGTH = (MAX_UPLOAD_SIZE_MB + 1) * 1024 * 1024
    MAX_JSON_BODY_SIZE_KB = _get_int_setting(
        "MAX_JSON_BODY_SIZE_KB",
        256,
        minimum=16,
        maximum=1024,
    )
    UPLOAD_STORAGE_PROVIDER = str(
        _get_setting("UPLOAD_STORAGE_PROVIDER", "local")
    ).strip().lower()
    UPLOAD_DIRECTORY = str(
        Path(
            _get_setting(
                "UPLOAD_DIRECTORY",
                str(BASE_DIR / "app" / "uploads"),
            )
        ).expanduser()
    )
    LOG_LEVEL = str(_get_setting("LOG_LEVEL", "INFO")).strip().upper()
    TRUST_PROXY = _get_bool_setting("TRUST_PROXY", IS_PRODUCTION)
    SLOW_REQUEST_THRESHOLD_MS = _get_int_setting(
        "SLOW_REQUEST_THRESHOLD_MS", 750, minimum=50, maximum=60000
    )
    RESPONSE_COMPRESSION_MIN_BYTES = _get_int_setting(
        "RESPONSE_COMPRESSION_MIN_BYTES", 1024, minimum=256, maximum=1048576
    )
    PUBLIC_CACHE_MAX_AGE_SECONDS = _get_int_setting(
        "PUBLIC_CACHE_MAX_AGE_SECONDS", 15, minimum=0, maximum=300
    )
    RATE_LIMIT_WINDOW_SECONDS = _get_int_setting(
        "RATE_LIMIT_WINDOW_SECONDS", 60, minimum=10, maximum=3600
    )
    RATE_LIMIT_AUTH = _get_int_setting(
        "RATE_LIMIT_AUTH", 10, minimum=1, maximum=1000
    )
    RATE_LIMIT_UPLOAD = _get_int_setting(
        "RATE_LIMIT_UPLOAD", 20, minimum=1, maximum=1000
    )
    RATE_LIMIT_MATCH_MUTATION = _get_int_setting(
        "RATE_LIMIT_MATCH_MUTATION", 30, minimum=1, maximum=1000
    )
    RATE_LIMIT_ADMIN_RESET = _get_int_setting(
        "RATE_LIMIT_ADMIN_RESET", 10, minimum=1, maximum=1000
    )
