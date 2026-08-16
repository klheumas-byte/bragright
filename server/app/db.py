import logging
import os
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values, load_dotenv
from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError


LOGGER = logging.getLogger(__name__)
SERVER_DIR = Path(__file__).resolve().parents[1]
ENV_PATH = SERVER_DIR / ".env"
USERS_COLLECTION_NAME = "users"
MATCHES_COLLECTION_NAME = "matches"
SETTINGS_COLLECTION_NAME = "settings"
LOGIN_ACTIVITY_COLLECTION_NAME = "login_activity"
ACTIVITY_LOGS_COLLECTION_NAME = "activity_logs"
AUTH_SESSIONS_COLLECTION_NAME = "auth_sessions"
PROOF_UPLOADS_COLLECTION_NAME = "proof_uploads"
SUBSCRIPTIONS_COLLECTION_NAME = "subscriptions"
PAYMENTS_COLLECTION_NAME = "payments"
REMITTANCES_COLLECTION_NAME = "remittances"
SUBSCRIPTION_EXEMPTIONS_COLLECTION_NAME = "subscription_exemptions"
FINANCIAL_AUDIT_LOGS_COLLECTION_NAME = "financial_audit_logs"
NOTIFICATIONS_COLLECTION_NAME = "notifications"
BILLING_RUNS_COLLECTION_NAME = "billing_runs"
PHYSICAL_FOOTBALL_SESSIONS_COLLECTION_NAME = "physical_football_sessions"
PHYSICAL_FOOTBALL_AVAILABILITY_COLLECTION_NAME = "physical_football_availability"
PHYSICAL_FOOTBALL_TEAMS_COLLECTION_NAME = "physical_football_teams"

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
    config_get = config.get if hasattr(config, "get") else lambda name, default=None: default
    mongo_uri = _clean_value(
        config_get("MONGODB_URI")
        or config_get("MONGO_URI")
        or os.getenv("MONGODB_URI")
        or os.getenv("MONGO_URI")
        or file_values.get("MONGODB_URI")
        or file_values.get("MONGO_URI")
    )
    mongo_db_name = _clean_value(
        config_get("MONGODB_DATABASE")
        or config_get("MONGO_DB_NAME")
        or os.getenv("MONGODB_DATABASE")
        or os.getenv("MONGO_DB_NAME")
        or file_values.get("MONGODB_DATABASE")
        or file_values.get("MONGO_DB_NAME")
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
            "MONGODB_URI is missing. Configure it and restart the service."
        )

    if not mongo_db_name:
        raise RuntimeError(
            "MONGODB_DATABASE is missing. Configure it and restart the service."
        )

    if "<username>" in mongo_uri or "<password>" in mongo_uri:
        raise RuntimeError(
            "MONGODB_URI still contains placeholder values."
        )

    if not mongo_uri.startswith(("mongodb://", "mongodb+srv://")):
        raise RuntimeError(
            "MONGODB_URI must start with mongodb:// or mongodb+srv://."
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

    config = config or {}
    config_get = (
        config.get
        if hasattr(config, "get")
        else lambda name, default=None: default
    )
    settings = get_mongo_settings(config=config)
    log = logger or LOGGER

    if force_reconnect and _mongo_client is not None:
        _mongo_client.close()
        _mongo_client = None
        _mongo_db = None

    try:
        client = MongoClient(
            settings["mongo_uri"],
            serverSelectionTimeoutMS=int(
                config_get("MONGODB_SERVER_SELECTION_TIMEOUT_MS", 5000)
            ),
            connectTimeoutMS=int(
                config_get("MONGODB_CONNECT_TIMEOUT_MS", 5000)
            ),
            socketTimeoutMS=int(
                config_get("MONGODB_SOCKET_TIMEOUT_MS", 10000)
            ),
            retryWrites=True,
            retryReads=True,
            appname="bragright",
        )
        client.admin.command("ping")
        database = client[settings["mongo_db_name"]]

        _mongo_client = client
        _mongo_db = database
        _mongo_settings = settings

        log.info(
            "MongoDB connection established.",
        )
        return _mongo_db
    except (ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError) as exc:
        _mongo_client = None
        _mongo_db = None
        _mongo_settings = settings
        log.exception(
            "MongoDB connection failed.",
        )
        raise


def get_db(config=None, logger=None):
    if _mongo_db is not None:
        return _mongo_db

    return init_db(config=config, logger=logger)


def get_users_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[USERS_COLLECTION_NAME]


def ensure_users_indexes(users_collection):
    users_collection.create_index("email", unique=True, name="users_email_unique")
    users_collection.create_index("username", name="users_username")
    users_collection.create_index(
        [("role", ASCENDING), ("status", ASCENDING)],
        name="users_role_status",
    )
    users_collection.create_index(
        [("role", ASCENDING), ("status", ASCENDING), ("username", ASCENDING)],
        name="users_public_directory",
    )


def get_matches_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[MATCHES_COLLECTION_NAME]


def ensure_matches_indexes(matches_collection):
    matches_collection.create_index(
        [("player_one_id", ASCENDING), ("updated_at", DESCENDING)],
        name="matches_player_one_updated",
    )
    matches_collection.create_index(
        [("player_two_id", ASCENDING), ("updated_at", DESCENDING)],
        name="matches_player_two_updated",
    )
    matches_collection.create_index(
        [("submitted_by", ASCENDING), ("updated_at", DESCENDING)],
        name="matches_submitted_by_updated",
    )
    matches_collection.create_index(
        [("opponent_id", ASCENDING), ("updated_at", DESCENDING)],
        name="matches_opponent_updated",
    )
    matches_collection.create_index(
        [("status", ASCENDING), ("updated_at", DESCENDING)],
        name="matches_status_updated",
    )
    matches_collection.create_index(
        [("status", ASCENDING), ("confirmed_at", DESCENDING)],
        name="matches_status_confirmed",
    )
    matches_collection.create_index(
        [("status", ASCENDING), ("disputed_at", DESCENDING)],
        name="matches_status_disputed",
    )
    matches_collection.create_index(
        [
            ("player_one_id", ASCENDING),
            ("player_two_id", ASCENDING),
            ("status", ASCENDING),
            ("created_at", DESCENDING),
        ],
        name="matches_duplicate_guard",
    )
    matches_collection.create_index(
        [
            ("submitted_by", ASCENDING),
            ("opponent_id", ASCENDING),
            ("status", ASCENDING),
            ("confirmed_at", DESCENDING),
        ],
        name="matches_rivalry_confirmed",
    )
    matches_collection.create_index(
        [
            ("status", ASCENDING),
            ("player_one_id", ASCENDING),
            ("confirmed_at", DESCENDING),
        ],
        name="matches_statistics_player_one",
    )
    matches_collection.create_index(
        [
            ("status", ASCENDING),
            ("player_two_id", ASCENDING),
            ("confirmed_at", DESCENDING),
        ],
        name="matches_statistics_player_two",
    )


def get_settings_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[SETTINGS_COLLECTION_NAME]


def ensure_settings_indexes(settings_collection):
    settings_collection.create_index("key", unique=True, name="settings_key_unique")


def get_login_activity_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[LOGIN_ACTIVITY_COLLECTION_NAME]


def ensure_login_activity_indexes(login_activity_collection):
    login_activity_collection.create_index(
        [("user_id", ASCENDING), ("logged_in_at", DESCENDING)],
        name="login_activity_user_time",
    )


def get_activity_logs_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[ACTIVITY_LOGS_COLLECTION_NAME]


def ensure_activity_logs_indexes(activity_logs_collection):
    activity_logs_collection.create_index(
        [("user_id", ASCENDING), ("created_at", DESCENDING)],
        name="activity_user_time",
    )
    activity_logs_collection.create_index(
        [("role", ASCENDING), ("created_at", DESCENDING)],
        name="activity_role_time",
    )
    activity_logs_collection.create_index(
        [("action_type", ASCENDING), ("created_at", DESCENDING)],
        name="activity_action_time",
    )
    activity_logs_collection.create_index(
        "event_key",
        unique=True,
        sparse=True,
        name="activity_event_key_unique",
    )


def get_auth_sessions_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[AUTH_SESSIONS_COLLECTION_NAME]


def get_proof_uploads_collection(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    return db[PROOF_UPLOADS_COLLECTION_NAME]


def get_subscriptions_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[SUBSCRIPTIONS_COLLECTION_NAME]


def get_payments_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[PAYMENTS_COLLECTION_NAME]


def get_remittances_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[REMITTANCES_COLLECTION_NAME]


def get_subscription_exemptions_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[SUBSCRIPTION_EXEMPTIONS_COLLECTION_NAME]


def get_financial_audit_logs_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[FINANCIAL_AUDIT_LOGS_COLLECTION_NAME]


def get_notifications_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[NOTIFICATIONS_COLLECTION_NAME]


def get_billing_runs_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[BILLING_RUNS_COLLECTION_NAME]


def get_physical_football_sessions_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[PHYSICAL_FOOTBALL_SESSIONS_COLLECTION_NAME]


def get_physical_football_availability_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[PHYSICAL_FOOTBALL_AVAILABILITY_COLLECTION_NAME]


def get_physical_football_teams_collection(config=None, logger=None):
    return get_db(config=config, logger=logger)[PHYSICAL_FOOTBALL_TEAMS_COLLECTION_NAME]


def ensure_auth_sessions_indexes(auth_sessions_collection):
    auth_sessions_collection.create_index(
        "session_id", unique=True, name="sessions_id_unique"
    )
    auth_sessions_collection.create_index(
        "token_hash", unique=True, name="sessions_token_hash_unique"
    )
    auth_sessions_collection.create_index("family_id", name="sessions_family")
    auth_sessions_collection.create_index(
        [("user_id", ASCENDING), ("revoked_at", ASCENDING)],
        name="sessions_user_revoked",
    )
    auth_sessions_collection.create_index(
        "expires_at",
        expireAfterSeconds=0,
        name="sessions_expiry_ttl",
    )


def ensure_proof_uploads_indexes(proof_uploads_collection):
    proof_uploads_collection.create_index(
        "filename", unique=True, name="uploads_filename_unique"
    )
    proof_uploads_collection.create_index(
        [("owner_id", ASCENDING), ("created_at", DESCENDING)],
        name="uploads_owner_time",
    )
    proof_uploads_collection.create_index("match_id", name="uploads_match")


def ensure_subscription_indexes(db):
    db[SUBSCRIPTIONS_COLLECTION_NAME].create_index(
        [("player_id", ASCENDING), ("billing_month", ASCENDING)],
        unique=True,
        name="subscriptions_player_month_unique",
    )
    db[SUBSCRIPTIONS_COLLECTION_NAME].create_index(
        [("billing_month", ASCENDING), ("status", ASCENDING)],
        name="subscriptions_month_status",
    )
    db[PAYMENTS_COLLECTION_NAME].create_index(
        [("player_id", ASCENDING), ("billing_month", ASCENDING), ("status", ASCENDING)],
        name="payments_player_month_status",
    )
    db[PAYMENTS_COLLECTION_NAME].create_index(
        [("recorded_by", ASCENDING), ("payment_date", DESCENDING)],
        name="payments_officer_date",
    )
    db[PAYMENTS_COLLECTION_NAME].create_index(
        "deduplication_key",
        unique=True,
        name="payments_deduplication_unique",
    )
    db[PAYMENTS_COLLECTION_NAME].create_index(
        "paystack_reference",
        unique=True,
        sparse=True,
        name="payments_paystack_reference_unique",
    )
    db[PAYMENTS_COLLECTION_NAME].create_index(
        "coverage_keys",
        unique=True,
        partialFilterExpression={"coverage_keys": {"$exists": True}},
        name="payments_subscription_coverage_unique",
    )
    db[REMITTANCES_COLLECTION_NAME].create_index(
        [("payment_officer_id", ASCENDING), ("submitted_at", DESCENDING)],
        name="remittances_officer_time",
    )
    db[REMITTANCES_COLLECTION_NAME].create_index(
        [("status", ASCENDING), ("submitted_at", DESCENDING)],
        name="remittances_status_time",
    )
    db[SUBSCRIPTION_EXEMPTIONS_COLLECTION_NAME].create_index(
        [("player_id", ASCENDING), ("billing_month", ASCENDING)],
        unique=True,
        name="exemptions_player_month_unique",
    )
    db[FINANCIAL_AUDIT_LOGS_COLLECTION_NAME].create_index(
        [("created_at", DESCENDING), ("action", ASCENDING)],
        name="financial_audit_time_action",
    )
    db[NOTIFICATIONS_COLLECTION_NAME].create_index(
        [("user_id", ASCENDING), ("created_at", DESCENDING)],
        name="notifications_user_time",
    )
    db[BILLING_RUNS_COLLECTION_NAME].create_index(
        "run_key", unique=True, name="billing_runs_key_unique"
    )


def ensure_physical_football_indexes(db):
    db[PHYSICAL_FOOTBALL_SESSIONS_COLLECTION_NAME].create_index(
        "session_date", unique=True, name="physical_football_session_date_unique"
    )
    db[PHYSICAL_FOOTBALL_SESSIONS_COLLECTION_NAME].create_index(
        [("status", ASCENDING), ("session_date", ASCENDING)],
        name="physical_football_status_date",
    )
    db[PHYSICAL_FOOTBALL_AVAILABILITY_COLLECTION_NAME].create_index(
        [("session_id", ASCENDING), ("player_id", ASCENDING)],
        unique=True,
        name="physical_football_availability_session_player_unique",
    )
    db[PHYSICAL_FOOTBALL_AVAILABILITY_COLLECTION_NAME].create_index(
        [("session_id", ASCENDING), ("status", ASCENDING)],
        name="physical_football_availability_session_status",
    )
    db[PHYSICAL_FOOTBALL_TEAMS_COLLECTION_NAME].create_index(
        "team_id", unique=True, name="physical_football_team_id_unique"
    )


def ensure_database_indexes(config=None, logger=None):
    """Create all application indexes during process startup, never per request."""
    db = get_db(config=config, logger=logger)
    ensure_users_indexes(db[USERS_COLLECTION_NAME])
    ensure_matches_indexes(db[MATCHES_COLLECTION_NAME])
    ensure_settings_indexes(db[SETTINGS_COLLECTION_NAME])
    ensure_login_activity_indexes(db[LOGIN_ACTIVITY_COLLECTION_NAME])
    ensure_activity_logs_indexes(db[ACTIVITY_LOGS_COLLECTION_NAME])
    ensure_auth_sessions_indexes(db[AUTH_SESSIONS_COLLECTION_NAME])
    ensure_proof_uploads_indexes(db[PROOF_UPLOADS_COLLECTION_NAME])
    ensure_subscription_indexes(db)
    ensure_physical_football_indexes(db)
    (logger or LOGGER).info("MongoDB indexes initialized.")


def check_database_ready(config=None, logger=None):
    db = get_db(config=config, logger=logger)
    db.client.admin.command("ping")
    return True


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
        debug["auth_sessions_collection"] = AUTH_SESSIONS_COLLECTION_NAME
        debug["proof_uploads_collection"] = PROOF_UPLOADS_COLLECTION_NAME
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
            "auth_sessions_collection": AUTH_SESSIONS_COLLECTION_NAME,
            "proof_uploads_collection": PROOF_UPLOADS_COLLECTION_NAME,
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
