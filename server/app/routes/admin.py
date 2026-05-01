import re
import secrets
import string
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.security import generate_password_hash

from ..db import (
    describe_mongo_error,
    get_db_debug_snapshot,
    get_matches_collection,
    get_users_collection,
)
from .auth import (
    USER_STATUS_ACTIVE,
    USER_STATUS_DISABLED,
    VALID_USER_STATUSES,
    get_current_user_from_request,
    get_user_status,
    serialize_user,
)
from ..services.admin_access import ADMIN_ROLE, PLAYER_ROLE, get_user_role, is_bootstrap_admin_email
from ..services.activity_logger import get_activity_logs, record_activity
from ..services.match_workflow import (
    MATCH_RESULT_SOURCE_ADMIN,
    MATCH_STATUS_CONFIRMED,
    MATCH_STATUS_DISPUTED,
    MATCH_STATUS_PENDING_CONFIRMATION,
    MATCH_STATUS_REJECTED,
    calculate_winner_id,
    format_match_status,
    is_valid_transition,
    now_utc,
    parse_object_id,
    resolve_match_players,
    serialize_match,
    validate_scores_and_winner,
)
from ..services.system_settings import get_system_settings, update_system_settings


admin_bp = Blueprint("admin", __name__)
VALID_RESOLUTION_ACTIONS = {"confirm_result", "reject_result", "override_result"}
VALID_ROLE_UPDATES = {PLAYER_ROLE, ADMIN_ROLE}


def _require_admin_user():
    current_user, error_response, status_code = get_current_user_from_request()
    if error_response:
        return None, error_response, status_code

    serialized_user = serialize_user(current_user)
    if serialized_user.get("role") != ADMIN_ROLE:
        return None, jsonify({"success": False, "message": "Admin access is required."}), 403

    return serialized_user, None, None


def _serialize_admin_match(match_document, users_by_id=None):
    users_by_id = users_by_id or {}
    serialized = serialize_match(match_document, None)
    players = resolve_match_players(match_document)
    disputed_by = match_document.get("disputed_by")
    reviewed_by = match_document.get("reviewed_by")

    serialized.update(
        {
            "player_score": match_document.get("player_one_score"),
            "opponent_score": match_document.get("player_two_score"),
            "players": {
                "submitted_by": {
                    "id": players["player_one_id"],
                    "username": players["player_one_name"],
                },
                "opponent": {
                    "id": players["player_two_id"],
                    "username": players["player_two_name"],
                },
                "disputed_by": {
                    "id": disputed_by,
                    "username": users_by_id.get(disputed_by, "Unknown reviewer") if disputed_by else None,
                },
                "reviewed_by": {
                    "id": reviewed_by,
                    "username": users_by_id.get(reviewed_by, "Unknown admin") if reviewed_by else None,
                },
            },
            "moderation": {
                "reviewed_by": reviewed_by,
                "reviewed_by_name": users_by_id.get(reviewed_by, "Unknown admin") if reviewed_by else None,
                "reviewed_at": serialized.get("reviewed_at"),
                "resolution_action": match_document.get("resolution_action"),
                "resolution_note": match_document.get("resolution_note"),
            },
            "timestamps": {
                "created_at": serialized.get("created_at"),
                "result_submitted_at": serialized.get("result_submitted_at"),
                "confirmed_at": serialized.get("confirmed_at"),
                "disputed_at": serialized.get("disputed_at"),
                "reviewed_at": serialized.get("reviewed_at"),
                "cancelled_at": serialized.get("cancelled_at"),
                "expired_at": serialized.get("expired_at"),
                "updated_at": serialized.get("updated_at"),
            },
        }
    )
    return serialized


def _serialize_admin_user(user_document):
    created_at = user_document.get("created_at")
    updated_at = user_document.get("updated_at")
    last_login_at = user_document.get("last_login_at")
    resolved_role = get_user_role(user_document, current_app.config)
    status = get_user_status(user_document)

    return {
        "id": str(user_document["_id"]),
        "username": user_document.get("username", ""),
        "email": user_document.get("email", ""),
        "role": resolved_role,
        "status": status,
        "is_active": status == USER_STATUS_ACTIVE,
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "last_login_at": last_login_at.isoformat() if last_login_at else None,
        "last_login_user_agent": user_document.get("last_login_user_agent"),
    }


def _load_match(match_id, *, required_status=None):
    normalized_id, object_id = parse_object_id(match_id)
    if not normalized_id or not object_id:
        return None, jsonify({"success": False, "message": "Match ID is invalid."}), 400

    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
    query = {"_id": object_id}
    if required_status:
        query["status"] = required_status

    match = matches.find_one(query)
    if not match:
        message = f"{format_match_status(required_status)} match not found." if required_status else "Match not found."
        return None, jsonify({"success": False, "message": message}), 404

    return match, None, None


def _load_user_by_id(user_id):
    try:
        user_object_id = ObjectId(user_id)
    except InvalidId:
        return None, jsonify({"success": False, "message": "User ID is invalid."}), 400

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    user = users.find_one({"_id": user_object_id})

    if not user:
        return None, jsonify({"success": False, "message": "User not found."}), 404

    return user, None, None


def _load_user_names(*user_ids):
    normalized_ids = [user_id for user_id in user_ids if user_id]
    if not normalized_ids:
        return {}

    object_ids = []
    for user_id in normalized_ids:
        try:
            object_ids.append(ObjectId(user_id))
        except InvalidId:
            continue

    if not object_ids:
        return {}

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    documents = list(users.find({"_id": {"$in": object_ids}}))
    return {
        str(document["_id"]): document.get("username") or document.get("email") or "Unknown user"
        for document in documents
    }


def _parse_resolution_payload(payload):
    action = str(payload.get("resolution_action", "")).strip()
    resolution_note = str(payload.get("resolution_note", "")).strip()

    if action not in VALID_RESOLUTION_ACTIONS:
        return None, "Resolution action is invalid."

    if not resolution_note:
        return None, "Resolution note is required."

    if len(resolution_note) > 500:
        return None, "Resolution note must be 500 characters or fewer."

    override_player_score = payload.get("override_player_score")
    override_opponent_score = payload.get("override_opponent_score")
    override_winner_id = str(payload.get("override_winner_id", "")).strip() or None

    if action == "override_result":
        if override_player_score is None or override_opponent_score is None:
            return None, "Override result requires both override scores."
    else:
        override_player_score = None
        override_opponent_score = None
        override_winner_id = None

    return {
        "resolution_action": action,
        "resolution_note": resolution_note,
        "override_player_score": override_player_score,
        "override_opponent_score": override_opponent_score,
        "override_winner_id": override_winner_id,
    }, None


def _parse_role_payload(payload):
    next_role = str(payload.get("role", "")).strip().lower()
    if next_role not in VALID_ROLE_UPDATES:
        return None, "Role must be either player or admin."
    return next_role, None


def _parse_status_payload(payload):
    if "status" in payload:
        next_status = str(payload.get("status", "")).strip().lower()
    elif "is_active" in payload:
        raw_is_active = payload.get("is_active")
        if not isinstance(raw_is_active, bool):
            return None, "Active status must be true or false."
        next_status = USER_STATUS_ACTIVE if raw_is_active else USER_STATUS_DISABLED
    else:
        return None, "Status is required."

    if next_status not in VALID_USER_STATUSES:
        return None, "Status must be either active or disabled."

    return next_status, None


def _parse_create_user_payload(payload):
    username = str(payload.get("username", "")).strip()
    email = str(payload.get("email", "")).strip().lower()
    role = str(payload.get("role", PLAYER_ROLE)).strip().lower() or PLAYER_ROLE

    if not username:
        return None, "Username is required."

    if len(username) < 3 or len(username) > 32:
        return None, "Username must be between 3 and 32 characters."

    if not re.fullmatch(r"[A-Za-z0-9_. -]+", username):
        return None, "Username can only contain letters, numbers, spaces, dots, underscores, and hyphens."

    if not email or "@" not in email:
        return None, "A valid email address is required."

    if role not in VALID_ROLE_UPDATES:
        return None, "Role must be either player or admin."

    temporary_password = str(payload.get("temporary_password", "")).strip()
    if temporary_password and len(temporary_password) < 8:
        return None, "Temporary password must be at least 8 characters."

    return {
        "username": username,
        "email": email,
        "role": role,
        "temporary_password": temporary_password or _generate_temporary_password(),
    }, None


def _resolve_override_winner_id(match, parsed_payload):
    explicit_winner_id = parsed_payload.get("override_winner_id")
    players = resolve_match_players(match)
    player_one_id = players["player_one_id"]
    player_two_id = players["player_two_id"]

    if explicit_winner_id:
        if explicit_winner_id not in {player_one_id, player_two_id}:
            return None, "Override winner must be one of the players in the disputed match."
        return explicit_winner_id, None

    derived_winner_id = calculate_winner_id(
        player_one_id,
        player_two_id,
        parsed_payload["override_player_score"],
        parsed_payload["override_opponent_score"],
    )
    return derived_winner_id, None


def _build_user_filters():
    role = str(request.args.get("role", "")).strip().lower()
    status = str(request.args.get("status", "")).strip().lower()
    search = str(request.args.get("search", "")).strip()

    query = {}

    if role in VALID_ROLE_UPDATES:
        query["role"] = role

    if status in VALID_USER_STATUSES:
        query["status"] = status

    if search:
        escaped_search = re.escape(search)
        query["$or"] = [
            {"username": {"$regex": escaped_search, "$options": "i"}},
            {"email": {"$regex": escaped_search, "$options": "i"}},
        ]

    return query, {"role": role or "all", "status": status or "all", "search": search}


def _count_admin_users(*, exclude_user_id=None):
    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    query = {"role": ADMIN_ROLE}

    if exclude_user_id:
        try:
            query["_id"] = {"$ne": ObjectId(exclude_user_id)}
        except InvalidId:
            pass

    return users.count_documents(query)


def _is_last_admin_user(user_document):
    resolved_role = get_user_role(user_document, current_app.config)
    if resolved_role != ADMIN_ROLE:
        return False

    return _count_admin_users(exclude_user_id=str(user_document["_id"])) == 0


def _generate_temporary_password(length=12):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _backfill_user_status_fields():
    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    users.update_many(
        {"status": {"$exists": False}, "is_active": False},
        {"$set": {"status": USER_STATUS_DISABLED}},
    )
    users.update_many(
        {
            "status": {"$exists": False},
            "$or": [{"is_active": {"$exists": False}}, {"is_active": True}],
        },
        {"$set": {"status": USER_STATUS_ACTIVE, "is_active": True}},
    )


def _build_admin_summary_payload(current_user):
    _backfill_user_status_fields()
    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
    users = get_users_collection(config=current_app.config, logger=current_app.logger)

    total_users = users.count_documents({})
    total_admins = users.count_documents({"role": ADMIN_ROLE})
    active_players = users.count_documents(
        {
            "$or": [{"role": PLAYER_ROLE}, {"role": {"$exists": False}}],
            "status": USER_STATUS_ACTIVE,
        }
    )
    disabled_accounts = users.count_documents({"status": USER_STATUS_DISABLED})
    open_disputes = matches.count_documents({"status": MATCH_STATUS_DISPUTED})
    pending_confirmations = matches.count_documents({"status": MATCH_STATUS_PENDING_CONFIRMATION})
    match_requests = matches.count_documents({"status": {"$in": ["match_requested", "scheduled"]}})
    total_matches = matches.count_documents({})
    recent_activity = get_activity_logs(limit=6)

    return {
        "total_users": total_users,
        "active_players": active_players,
        "disabled_accounts": disabled_accounts,
        "open_disputes": open_disputes,
        "pending_confirmations": pending_confirmations,
        "match_requests": match_requests,
        "recent_activity_count": len(recent_activity),
        "total_matches": total_matches,
        "total_admins": total_admins,
        "disputed_matches": open_disputes,
        "pending_reviews": pending_confirmations + open_disputes,
        "total_players": users.count_documents({"$or": [{"role": PLAYER_ROLE}, {"role": {"$exists": False}}]}),
        "system_activity": total_matches,
        "recent_activity": recent_activity,
        "access_summary": {
            "admin_id": current_user["id"],
            "role": current_user["role"],
            "status": current_user["status"],
        },
    }


def _build_admin_profile_payload(current_user):
    summary = _build_admin_summary_payload(current_user)
    recent_admin_activity = get_activity_logs(user_id=current_user["id"], limit=8)

    return {
        **current_user,
        "recent_admin_activity": recent_admin_activity,
        "quick_links": [
            {"label": "Users", "to": "/admin/users"},
            {"label": "Activity", "to": "/admin/activity"},
            {"label": "Settings", "to": "/admin/settings"},
            {"label": "Disputes", "to": "/admin/disputes"},
        ],
        "access_summary": {
            "managed_users": summary["total_users"],
            "active_players": summary["active_players"],
            "disabled_accounts": summary["disabled_accounts"],
            "open_disputes": summary["open_disputes"],
            "pending_confirmations": summary["pending_confirmations"],
            "match_requests": summary["match_requests"],
        },
    }


@admin_bp.get("/summary")
@admin_bp.get("/dashboard/summary")
def get_admin_summary():
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        return jsonify(
            {
                "success": True,
                "message": "Admin summary loaded successfully.",
                "data": _build_admin_summary_payload(current_user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading admin summary")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading admin summary")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading admin summary")
        return jsonify({"success": False, "message": "Could not load the admin summary."}), 500


@admin_bp.get("/profile/me")
def get_admin_profile():
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        return jsonify(
            {
                "success": True,
                "message": "Admin profile loaded successfully.",
                "data": _build_admin_profile_payload(current_user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading admin profile")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading admin profile")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading admin profile")
        return jsonify({"success": False, "message": "Could not load the admin profile."}), 500


@admin_bp.get("/users")
def get_admin_users():
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        _backfill_user_status_fields()
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        query, applied_filters = _build_user_filters()
        documents = list(users.find(query).sort("created_at", DESCENDING))

        return jsonify(
            {
                "success": True,
                "message": "Users loaded successfully.",
                "data": {
                    "users": [_serialize_admin_user(document) for document in documents],
                    "filters": applied_filters,
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading users")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading users")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading users")
        return jsonify({"success": False, "message": "Could not load users."}), 500


@admin_bp.post("/users")
def create_admin_user():
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        payload = request.get_json(silent=True) or {}
        parsed_payload, validation_error = _parse_create_user_payload(payload)
        if validation_error:
            return jsonify({"success": False, "message": validation_error}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        username_regex = re.compile(f"^{re.escape(parsed_payload['username'])}$", re.IGNORECASE)

        if users.find_one({"email": parsed_payload["email"]}):
            return jsonify({"success": False, "message": "An account with this email already exists."}), 409

        if users.find_one({"username": username_regex}):
            return jsonify({"success": False, "message": "That username is already in use."}), 409

        created_at = datetime.now(timezone.utc)
        user_document = {
            "username": parsed_payload["username"],
            "email": parsed_payload["email"],
            "password_hash": generate_password_hash(parsed_payload["temporary_password"]),
            "role": parsed_payload["role"],
            "status": USER_STATUS_ACTIVE,
            "is_active": True,
            "created_at": created_at,
            "last_login": None,
            "last_login_at": None,
            "profile_image": None,
            "updated_at": created_at,
        }

        result = users.insert_one(user_document)
        created_user = users.find_one({"_id": result.inserted_id})

        record_activity(
            user=current_user,
            action_type="admin_user_created",
            action_label="Admin created user",
            details={
                "target_user_id": str(result.inserted_id),
                "target_email": parsed_payload["email"],
                "target_role": parsed_payload["role"],
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "User created successfully.",
                "data": {
                    "user": _serialize_admin_user(created_user),
                    "temporary_password": parsed_payload["temporary_password"],
                },
            }
        ), 201
    except DuplicateKeyError:
        return jsonify({"success": False, "message": "An account with this email already exists."}), 409
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while creating user")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while creating user")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while creating user")
        return jsonify({"success": False, "message": "Could not create the user."}), 500


@admin_bp.patch("/users/<user_id>/role")
def update_admin_user_role(user_id):
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        target_user, error_response, status_code = _load_user_by_id(user_id)
        if error_response:
            return error_response, status_code

        payload = request.get_json(silent=True) or {}
        next_role, validation_error = _parse_role_payload(payload)
        if validation_error:
            return jsonify({"success": False, "message": validation_error}), 400

        current_role = get_user_role(target_user, current_app.config)
        if current_role == next_role:
            return jsonify({"success": False, "message": "User already has that role."}), 400

        if str(target_user["_id"]) == current_user["id"] and next_role != ADMIN_ROLE:
            return jsonify({"success": False, "message": "You cannot remove your own admin role."}), 400

        if (
            next_role != ADMIN_ROLE
            and is_bootstrap_admin_email(target_user.get("email"), current_app.config)
        ):
            return jsonify(
                {
                    "success": False,
                    "message": "This bootstrap admin account cannot be changed to player.",
                }
            ), 400

        if current_role == ADMIN_ROLE and next_role != ADMIN_ROLE and _is_last_admin_user(target_user):
            return jsonify({"success": False, "message": "You cannot remove the last admin."}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        users.update_one(
            {"_id": target_user["_id"]},
            {
                "$set": {
                    "role": next_role,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        updated_user = users.find_one({"_id": target_user["_id"]})
        record_activity(
            user=current_user,
            action_type="admin_role_changed",
            action_label="Admin changed user role",
            details={
                "target_user_id": str(target_user["_id"]),
                "target_email": target_user.get("email", ""),
                "previous_role": current_role,
                "new_role": next_role,
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "User role updated successfully.",
                "data": _serialize_admin_user(updated_user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while updating user role")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while updating user role")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while updating user role")
        return jsonify({"success": False, "message": "Could not update the user role."}), 500


@admin_bp.patch("/users/<user_id>/status")
def update_admin_user_status(user_id):
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        target_user, error_response, status_code = _load_user_by_id(user_id)
        if error_response:
            return error_response, status_code

        payload = request.get_json(silent=True) or {}
        next_status, validation_error = _parse_status_payload(payload)
        if validation_error:
            return jsonify({"success": False, "message": validation_error}), 400

        current_status = get_user_status(target_user)
        if current_status == next_status:
            return jsonify({"success": False, "message": "User already has that status."}), 400

        if str(target_user["_id"]) == current_user["id"] and next_status != USER_STATUS_ACTIVE:
            return jsonify({"success": False, "message": "You cannot disable your own account."}), 400

        if (
            get_user_role(target_user, current_app.config) == ADMIN_ROLE
            and next_status == USER_STATUS_DISABLED
            and _is_last_admin_user(target_user)
        ):
            return jsonify({"success": False, "message": "You cannot disable the last admin."}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        users.update_one(
            {"_id": target_user["_id"]},
            {
                "$set": {
                    "status": next_status,
                    "is_active": next_status == USER_STATUS_ACTIVE,
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        updated_user = users.find_one({"_id": target_user["_id"]})
        record_activity(
            user=current_user,
            action_type="admin_status_changed",
            action_label="Admin changed user status",
            details={
                "target_user_id": str(target_user["_id"]),
                "target_email": target_user.get("email", ""),
                "previous_status": current_status,
                "new_status": next_status,
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "User status updated successfully.",
                "data": _serialize_admin_user(updated_user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while updating user status")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while updating user status")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while updating user status")
        return jsonify({"success": False, "message": "Could not update the user status."}), 500


@admin_bp.post("/users/<user_id>/reset-password")
@admin_bp.patch("/users/<user_id>/password")
def reset_admin_user_password(user_id):
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        target_user, error_response, status_code = _load_user_by_id(user_id)
        if error_response:
            return error_response, status_code

        temporary_password = _generate_temporary_password()

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        users.update_one(
            {"_id": target_user["_id"]},
            {
                "$set": {
                    "password_hash": generate_password_hash(temporary_password),
                    "updated_at": datetime.now(timezone.utc),
                }
            },
        )
        record_activity(
            user=current_user,
            action_type="admin_password_reset",
            action_label="Admin reset user password",
            details={
                "target_user_id": str(target_user["_id"]),
                "target_email": target_user.get("email", ""),
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "Temporary password generated successfully.",
                "data": {
                    "user_id": str(target_user["_id"]),
                    "temporary_password": temporary_password,
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while resetting password")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while resetting password")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while resetting password")
        return jsonify({"success": False, "message": "Could not reset the user password."}), 500


@admin_bp.get("/settings")
def get_admin_settings():
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        settings = get_system_settings()
        return jsonify(
            {
                "success": True,
                "message": "Settings loaded successfully.",
                "data": settings,
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading settings")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading settings")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading settings")
        return jsonify({"success": False, "message": "Could not load settings."}), 500


@admin_bp.patch("/settings")
def update_admin_settings():
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        payload = request.get_json(silent=True) or {}
        settings = update_system_settings(payload)
        record_activity(
            user=current_user,
            action_type="admin_settings_updated",
            action_label="Admin updated system settings",
            details=settings,
        )
        return jsonify(
            {
                "success": True,
                "message": "Settings updated successfully.",
                "data": settings,
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while updating settings")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while updating settings")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while updating settings")
        return jsonify({"success": False, "message": "Could not update settings."}), 500


@admin_bp.get("/activity")
def get_admin_activity():
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        filters = {
            "user": request.args.get("user"),
            "role": request.args.get("role"),
            "action_type": request.args.get("action_type"),
            "start_date": request.args.get("start_date"),
            "end_date": request.args.get("end_date"),
        }
        serialized = get_activity_logs(filters=filters, limit=100)

        return jsonify(
            {
                "success": True,
                "message": "Activity logs loaded successfully.",
                "data": {
                    "logs": serialized,
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading activity logs")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading activity logs")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading activity logs")
        return jsonify({"success": False, "message": "Could not load activity logs."}), 500


@admin_bp.get("/logins")
def get_admin_logins():
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        filters = {
            "user": request.args.get("user"),
            "role": request.args.get("role"),
            "start_date": request.args.get("start_date"),
            "end_date": request.args.get("end_date"),
        }
        serialized = get_activity_logs(filters=filters, action_types=["login"], limit=50)

        return jsonify(
            {
                "success": True,
                "message": "Login logs loaded successfully.",
                "data": {
                    "logs": serialized,
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading login logs")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading login logs")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading login logs")
        return jsonify({"success": False, "message": "Could not load login logs."}), 500


@admin_bp.get("/matches")
def get_admin_matches():
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        status_filter = str(request.args.get("status", "")).strip().lower()
        player_filter = str(request.args.get("player", "")).strip()
        start_date = str(request.args.get("date_from", "")).strip()
        end_date = str(request.args.get("date_to", "")).strip()

        query = {}
        if status_filter:
            query["status"] = status_filter

        if player_filter:
            query["$or"] = [
                {"player_one_id": player_filter},
                {"player_two_id": player_filter},
                {"player_one_name": {"$regex": re.escape(player_filter), "$options": "i"}},
                {"player_two_name": {"$regex": re.escape(player_filter), "$options": "i"}},
            ]

        date_query = {}
        if start_date:
            try:
                date_query["$gte"] = datetime.fromisoformat(start_date).astimezone(timezone.utc)
            except ValueError:
                return jsonify({"success": False, "message": "date_from is invalid."}), 400
        if end_date:
            try:
                date_query["$lte"] = datetime.fromisoformat(end_date).astimezone(timezone.utc)
            except ValueError:
                return jsonify({"success": False, "message": "date_to is invalid."}), 400
        if date_query:
            query["created_at"] = date_query

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        documents = list(matches.find(query).sort("updated_at", DESCENDING))

        user_ids = []
        for document in documents:
            user_ids.extend(
                [
                    document.get("player_one_id") or document.get("submitted_by"),
                    document.get("player_two_id") or document.get("opponent_id"),
                    document.get("disputed_by"),
                    document.get("reviewed_by"),
                ]
            )
        users_by_id = _load_user_names(*user_ids)

        return jsonify(
            {
                "success": True,
                "message": "Admin matches loaded successfully.",
                "data": {
                    "matches": [_serialize_admin_match(document, users_by_id) for document in documents],
                    "filters": {
                        "status": status_filter or "all",
                        "player": player_filter,
                        "date_from": start_date,
                        "date_to": end_date,
                    },
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading admin matches")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading admin matches")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading admin matches")
        return jsonify({"success": False, "message": "Could not load admin matches."}), 500


@admin_bp.get("/disputes")
def get_admin_disputes():
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        documents = list(matches.find({"status": MATCH_STATUS_DISPUTED}).sort("disputed_at", DESCENDING))

        user_ids = []
        for document in documents:
            user_ids.extend(
                [
                    document.get("player_one_id") or document.get("submitted_by"),
                    document.get("player_two_id") or document.get("opponent_id"),
                    document.get("disputed_by"),
                    document.get("reviewed_by"),
                ]
            )

        users_by_id = _load_user_names(*user_ids, current_user["id"])
        serialized_matches = [_serialize_admin_match(document, users_by_id) for document in documents]

        return jsonify(
            {
                "success": True,
                "message": "Disputed matches loaded successfully.",
                "data": {
                    "matches": serialized_matches,
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading admin disputes")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading admin disputes")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading admin disputes")
        return jsonify({"success": False, "message": "Could not load disputed matches."}), 500


@admin_bp.get("/disputes/<match_id>")
def get_admin_dispute_detail(match_id):
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        match, error_response, status_code = _load_match(match_id, required_status=MATCH_STATUS_DISPUTED)
        if error_response:
            return error_response, status_code

        users_by_id = _load_user_names(
            match.get("player_one_id") or match.get("submitted_by"),
            match.get("player_two_id") or match.get("opponent_id"),
            match.get("disputed_by"),
            match.get("reviewed_by"),
        )

        return jsonify(
            {
                "success": True,
                "message": "Disputed match detail loaded successfully.",
                "data": _serialize_admin_match(match, users_by_id),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading dispute detail")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading dispute detail")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading dispute detail")
        return jsonify({"success": False, "message": "Could not load disputed match detail."}), 500


@admin_bp.get("/matches/<match_id>")
def get_admin_match_detail(match_id):
    try:
        _, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        match, error_response, status_code = _load_match(match_id)
        if error_response:
            return error_response, status_code

        users_by_id = _load_user_names(
            match.get("player_one_id") or match.get("submitted_by"),
            match.get("player_two_id") or match.get("opponent_id"),
            match.get("disputed_by"),
            match.get("reviewed_by"),
        )

        return jsonify(
            {
                "success": True,
                "message": "Match detail loaded successfully.",
                "data": _serialize_admin_match(match, users_by_id),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading match detail")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading match detail")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading match detail")
        return jsonify({"success": False, "message": "Could not load match detail."}), 500


@admin_bp.patch("/disputes/<match_id>/resolve")
@admin_bp.patch("/matches/<match_id>/resolve")
def resolve_admin_dispute(match_id):
    try:
        current_user, auth_error, auth_status = _require_admin_user()
        if auth_error:
            return auth_error, auth_status

        match, error_response, status_code = _load_match(match_id, required_status=MATCH_STATUS_DISPUTED)
        if error_response:
            return error_response, status_code

        payload = request.get_json(silent=True) or {}
        parsed_payload, validation_error = _parse_resolution_payload(payload)
        if validation_error:
            return jsonify({"success": False, "message": validation_error}), 400

        override_winner_id = None
        if parsed_payload["resolution_action"] == "override_result":
            score_validation, score_error = validate_scores_and_winner(
                match,
                parsed_payload["override_player_score"],
                parsed_payload["override_opponent_score"],
                parsed_payload["override_winner_id"],
            )
            if score_error:
                return jsonify({"success": False, "message": score_error}), 400
            parsed_payload["override_player_score"] = score_validation["player_one_score"]
            parsed_payload["override_opponent_score"] = score_validation["player_two_score"]
            override_winner_id, override_winner_error = _resolve_override_winner_id(match, parsed_payload)
            if override_winner_error:
                return jsonify({"success": False, "message": override_winner_error}), 400

        if not is_valid_transition(match.get("status"), MATCH_STATUS_CONFIRMED) and parsed_payload["resolution_action"] != "reject_result":
            return jsonify({"success": False, "message": "This disputed match can no longer be resolved to confirmed."}), 400

        reviewed_at = now_utc()
        updated_fields = {
            "previous_status": match.get("status"),
            "reviewed_by": current_user["id"],
            "reviewed_at": reviewed_at,
            "resolution_action": parsed_payload["resolution_action"],
            "resolution_note": parsed_payload["resolution_note"],
            "updated_at": reviewed_at,
        }

        if parsed_payload["resolution_action"] == "confirm_result":
            updated_fields.update(
                {
                    "status": MATCH_STATUS_CONFIRMED,
                    "confirmed_at": reviewed_at,
                    "winner_id": match.get("winner_id")
                    or calculate_winner_id(
                        match.get("player_one_id") or match.get("submitted_by"),
                        match.get("player_two_id") or match.get("opponent_id"),
                        match.get("player_one_score", 0),
                        match.get("player_two_score", 0),
                    ),
                }
            )
        elif parsed_payload["resolution_action"] == "reject_result":
            updated_fields.update(
                {
                    "status": MATCH_STATUS_REJECTED,
                    "confirmed_at": None,
                    "winner_id": None,
                }
            )
        else:
            updated_fields.update(
                {
                    "status": MATCH_STATUS_CONFIRMED,
                    "confirmed_at": reviewed_at,
                    "player_one_score": parsed_payload["override_player_score"],
                    "player_two_score": parsed_payload["override_opponent_score"],
                    "winner_id": override_winner_id,
                    "result_source": MATCH_RESULT_SOURCE_ADMIN,
                }
            )

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        matches.update_one({"_id": match["_id"]}, {"$set": updated_fields})
        updated_match = matches.find_one({"_id": match["_id"]})
        activity_type = "admin_match_resolved"
        activity_label = "Admin resolved match"
        if parsed_payload["resolution_action"] == "reject_result":
            activity_type = "admin_match_rejected"
            activity_label = "Admin rejected match result"
        elif parsed_payload["resolution_action"] == "override_result":
            activity_type = "admin_match_overridden"
            activity_label = "Admin overrode match result"

        record_activity(
            user=current_user,
            action_type=activity_type,
            action_label=activity_label,
            details={
                "match_id": str(match["_id"]),
                "resolution_action": parsed_payload["resolution_action"],
                "resolution_note": parsed_payload["resolution_note"],
                "override_player_score": parsed_payload["override_player_score"],
                "override_opponent_score": parsed_payload["override_opponent_score"],
            },
        )
        users_by_id = _load_user_names(
            updated_match.get("player_one_id") or updated_match.get("submitted_by"),
            updated_match.get("player_two_id") or updated_match.get("opponent_id"),
            updated_match.get("disputed_by"),
            updated_match.get("reviewed_by"),
        )

        return jsonify(
            {
                "success": True,
                "message": "Dispute resolved successfully.",
                "data": _serialize_admin_match(updated_match, users_by_id),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while resolving dispute")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while resolving dispute")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while resolving dispute")
        return jsonify({"success": False, "message": "Could not resolve the dispute."}), 500
