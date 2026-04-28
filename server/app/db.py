import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values, load_dotenv
from pymongo import MongoClient
from pymongo.errors import ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError


LOGGER = logging.getLogger(__name__)
SERVER_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = SERVER_DIR / ".env"
USERS_COLLECTION_NAME = "users"
MATCHES_COLLECTION_NAME = "matches"
SETTINGS_COLLECTION_NAME = "settings"
LOGIN_ACTIVITY_COLLECTION_NAME = "login_activity"
ACTIVITY_LOGS_COLLECTION_NAME = "activity_logs"

_env_loaded = False
_mongo_client = None
_mongo_db = None
_mongo_settings = None


def load_server_env():
    """Load environment variables from server/.env exactly once."""
    global _env_loaded

    if _env_loaded:
        return ENV_PATH

    load_dotenv(ENV_PATH, override=False)
    _env_loaded = True
    return ENV_PATH


def _clean_value(value):
    if value is None:
        return None

    cleaned = str(value).strip()
    return cleaned or None


def _mask_uri(mongo_uri):
    if not mongo_uri:
        return None

    try:
        parsed = urlsplit(mongo_uri)
    except ValueError:
        return "<invalid-uri>"

    host = parsed.netloc.rsplit("@", 1)[-1]
    scheme = parsed.scheme or "mongodb+srv"
    return f"{scheme}://***@{host}"


def get_mongo_settings(config=None):
    load_server_env()

    config = config or {}
    file_values = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    mongo_uri = _clean_value(
        file_values.get("MONGO_URI") or config.get("MONGO_URI") or os.getenv("MONGO_URI")
    )
    mongo_db_name = _clean_value(
        file_values.get("MONGO_DB_NAME")
        or config.get("MONGO_DB_NAME")
        or os.getenv("MONGO_DB_NAME")
    )

    env_details = {
        "env_path": str(ENV_PATH),
        "env_file_found": ENV_PATH.exists(),
        "mongo_uri_present": bool(mongo_uri),
        "mongo_db_name_present": bool(mongo_db_name),
        "mongo_uri_preview": _mask_uri(mongo_uri),
        "mongo_db_name": mongo_db_name,
    }

    if not mongo_uri:
        raise RuntimeError(
            "MONGO_URI is missing. Add it to server/.env, then restart the Flask server."
        )

    if not mongo_db_name:
        raise RuntimeError(
            "MONGO_DB_NAME is missing. Add it to server/.env, then restart the Flask server."
        )

    if "<username>" in mongo_uri or "<password>" in mongo_uri:
        raise RuntimeError(
            "MONGO_URI still contains placeholder values. Replace them in server/.env and restart the Flask server."
        )

    if not mongo_uri.startswith(("mongodb://", "mongodb+srv://")):
        raise RuntimeError(
            "MONGO_URI must start with mongodb:// or mongodb+srv://."
        )

    return {
        "mongo_uri": mongo_uri,
        "mongo_db_name": mongo_db_name,
        "env_details": env_details,
    }


def init_db(config=None, logger=None, force_reconnect=False):
    """Create the Mongo client once and verify the configured database."""
    global _mongo_client, _mongo_db, _mongo_settings

    if _mongo_db is not None and not force_reconnect:
        return _mongo_db

    settings = get_mongo_settings(config=config)
    log = logger or LOGGER

    if force_reconnect and _mongo_client is not None:
        _mongo_client.close()
        _mongo_client = None
        _mongo_db = None

    try:
        client = MongoClient(
            settings["mongo_uri"],
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=5000,
            retryWrites=True,
        )
        client.admin.command("ping")
        database = client[settings["mongo_db_name"]]
        database.list_collection_names()

        _mongo_client = client
        _mongo_db = database
        _mongo_settings = settings

        log.info(
            "MongoDB connected successfully. env=%s uri=%s db=%s users_collection=%s",
            settings["env_details"]["env_path"],
            settings["env_details"]["mongo_uri_preview"],
            settings["mongo_db_name"],
            USERS_COLLECTION_NAME,
        )
        return _mongo_db
    except (ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError) as exc:
        _mongo_client = None
        _mongo_db = None
        _mongo_settings = settings
        log.exception(
            "MongoDB connection failed. env=%s uri=%s db=%s",
            settings["env_details"]["env_path"],
            settings["env_details"]["mongo_uri_preview"],
            settings["mongo_db_name"],
        )
        raise


def get_db(config=None, logger=None):
    if _mongo_db is not None:
        return _mongo_db

    return init_db(config=config, logger=logger)


def get_users_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    users = db[USERS_COLLECTION_NAME]
    ensure_users_indexes(users)
    return users


def ensure_users_indexes(users_collection):
    users_collection.create_index("email", unique=True)
    users_collection.create_index("username")


def get_matches_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    matches = db[MATCHES_COLLECTION_NAME]
    ensure_matches_indexes(matches)
    return matches


def ensure_matches_indexes(matches_collection):
    matches_collection.create_index("player_one_id")
    matches_collection.create_index("player_two_id")
    matches_collection.create_index("created_by")
    matches_collection.create_index("result_submitted_by")
    matches_collection.create_index("confirmed_by")
    matches_collection.create_index("disputed_by")
    matches_collection.create_index("reviewed_by")
    matches_collection.create_index("submitted_by")
    matches_collection.create_index("opponent_id")
    matches_collection.create_index("status")
    matches_collection.create_index("created_at")
    matches_collection.create_index("updated_at")


def get_settings_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    settings = db[SETTINGS_COLLECTION_NAME]
    ensure_settings_indexes(settings)
    return settings


def ensure_settings_indexes(settings_collection):
    settings_collection.create_index("key", unique=True)


def get_login_activity_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    login_activity = db[LOGIN_ACTIVITY_COLLECTION_NAME]
    ensure_login_activity_indexes(login_activity)
    return login_activity


def ensure_login_activity_indexes(login_activity_collection):
    login_activity_collection.create_index("user_id")
    login_activity_collection.create_index("logged_in_at")


def get_activity_logs_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    activity_logs = db[ACTIVITY_LOGS_COLLECTION_NAME]
    ensure_activity_logs_indexes(activity_logs)
    return activity_logs


def ensure_activity_logs_indexes(activity_logs_collection):
    activity_logs_collection.create_index("user_id")
    activity_logs_collection.create_index("role")
    activity_logs_collection.create_index("action_type")
    activity_logs_collection.create_index("created_at")


def get_db_debug_snapshot(config=None):
    try:
        settings = get_mongo_settings(config=config)
        debug = dict(settings["env_details"])
        debug["connected"] = _mongo_db is not None
        debug["users_collection"] = USERS_COLLECTION_NAME
        debug["matches_collection"] = MATCHES_COLLECTION_NAME
        debug["settings_collection"] = SETTINGS_COLLECTION_NAME
        debug["login_activity_collection"] = LOGIN_ACTIVITY_COLLECTION_NAME
        debug["activity_logs_collection"] = ACTIVITY_LOGS_COLLECTION_NAME
        return debug
    except RuntimeError as exc:
        return {
            "env_path": str(ENV_PATH),
            "env_file_found": ENV_PATH.exists(),
            "connected": False,
            "error": str(exc),
            "users_collection": USERS_COLLECTION_NAME,
            "matches_collection": MATCHES_COLLECTION_NAME,
            "settings_collection": SETTINGS_COLLECTION_NAME,
            "login_activity_collection": LOGIN_ACTIVITY_COLLECTION_NAME,
            "activity_logs_collection": ACTIVITY_LOGS_COLLECTION_NAME,
        }


def describe_mongo_error(error):
    message = str(error).lower()

    if isinstance(error, OperationFailure) and "bad auth" in message:
        return (
            "MongoDB Atlas authentication failed. Check the Atlas database username, "
            "password, and the URI in server/.env, then restart the Flask server."
        )

    if isinstance(error, ConfigurationError):
        if "resolution lifetime expired" in message or "dns" in message or "srv" in message:
            return (
                "MongoDB Atlas DNS lookup failed. Your mongodb+srv URI was found, but this machine "
                "could not resolve the Atlas cluster host. Check internet access, DNS, VPN/firewall "
                "settings, or use the non-SRV Atlas connection string if needed."
            )
        return "MongoDB URI format is invalid. Check MONGO_URI in server/.env."

    if isinstance(error, ConnectionFailure):
        return "Could not reach MongoDB Atlas. Check your network access, IP allowlist, and cluster status."

    return "Database request failed. Please try again later."
