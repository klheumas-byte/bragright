from datetime import datetime, timezone

from flask import current_app
from pymongo.errors import PyMongoError

from ..db import get_settings_collection


DEFAULT_MATCH_DUPLICATE_WINDOW_MINUTES = 4
MIN_MATCH_DUPLICATE_WINDOW_MINUTES = 1
MAX_MATCH_DUPLICATE_WINDOW_MINUTES = 60
SETTINGS_DOCUMENT_KEY = "core"


def _get_default_settings():
    return {
        "duplicate_window_minutes": DEFAULT_MATCH_DUPLICATE_WINDOW_MINUTES,
    }


def _sanitize_duplicate_window_minutes(raw_value):
    try:
        minutes = int(raw_value)
    except (TypeError, ValueError):
        minutes = DEFAULT_MATCH_DUPLICATE_WINDOW_MINUTES

    return max(MIN_MATCH_DUPLICATE_WINDOW_MINUTES, min(minutes, MAX_MATCH_DUPLICATE_WINDOW_MINUTES))


def get_system_settings():
    defaults = _get_default_settings()

    try:
      settings_collection = get_settings_collection(config=current_app.config, logger=current_app.logger)
      document = settings_collection.find_one({"key": SETTINGS_DOCUMENT_KEY}) or {}
    except (RuntimeError, PyMongoError):
      current_app.logger.exception("Could not load settings collection, falling back to config defaults")
      config_default = current_app.config.get(
          "MATCH_DUPLICATE_WINDOW_MINUTES",
          DEFAULT_MATCH_DUPLICATE_WINDOW_MINUTES,
      )
      return {
          **defaults,
          "duplicate_window_minutes": _sanitize_duplicate_window_minutes(config_default),
      }

    return {
        **defaults,
        "duplicate_window_minutes": _sanitize_duplicate_window_minutes(
            document.get(
                "duplicate_window_minutes",
                current_app.config.get("MATCH_DUPLICATE_WINDOW_MINUTES", DEFAULT_MATCH_DUPLICATE_WINDOW_MINUTES),
            )
        ),
    }


def update_system_settings(payload):
    current_settings = get_system_settings()
    next_settings = {
        **current_settings,
        "duplicate_window_minutes": _sanitize_duplicate_window_minutes(
            payload.get("duplicate_window_minutes", current_settings["duplicate_window_minutes"])
        ),
    }

    settings_collection = get_settings_collection(config=current_app.config, logger=current_app.logger)
    settings_collection.update_one(
        {"key": SETTINGS_DOCUMENT_KEY},
        {
            "$set": {
                **next_settings,
                "updated_at": datetime.now(timezone.utc),
            }
        },
        upsert=True,
    )
    return next_settings


def get_match_duplicate_window_minutes():
    return get_system_settings()["duplicate_window_minutes"]
