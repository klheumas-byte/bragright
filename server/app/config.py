import os
from pathlib import Path

from dotenv import dotenv_values

from .db import load_server_env


BASE_DIR = Path(__file__).resolve().parents[1]
load_server_env()
ENV_VALUES = dotenv_values(BASE_DIR / ".env") if (BASE_DIR / ".env").exists() else {}


def _get_setting(name, default=None):
    return ENV_VALUES.get(name) or os.getenv(name, default)


class Config:
    DEBUG = _get_setting("FLASK_DEBUG", "true").lower() == "true"
    HOST = _get_setting("FLASK_HOST", "0.0.0.0")
    PORT = int(_get_setting("FLASK_PORT", "5000"))
    MONGO_URI = _get_setting("MONGO_URI")
    MONGO_DB_NAME = _get_setting("MONGO_DB_NAME")
    FRONTEND_ORIGIN = _get_setting("FRONTEND_ORIGIN", "http://localhost:5173")
    MATCH_DUPLICATE_WINDOW_MINUTES = int(_get_setting("MATCH_DUPLICATE_WINDOW_MINUTES", "4"))
    ADMIN_EMAILS = _get_setting("ADMIN_EMAILS", "")
