from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.security import check_password_hash, generate_password_hash

from ..db import (
    describe_mongo_error,
    get_db_debug_snapshot,
    get_users_collection,
)
from ..services.admin_access import ADMIN_ROLE, PLAYER_ROLE, get_user_role, is_bootstrap_admin_email
from ..services.activity_logger import record_activity


auth_bp = Blueprint("auth", __name__)
USER_STATUS_ACTIVE = "active"
USER_STATUS_DISABLED = "disabled"
VALID_USER_STATUSES = {USER_STATUS_ACTIVE, USER_STATUS_DISABLED}


def get_user_status(user):
    if not user:
        return USER_STATUS_ACTIVE

    stored_status = str(user.get("status", "")).strip().lower()
    if stored_status in VALID_USER_STATUSES:
        return stored_status

    return USER_STATUS_ACTIVE if user.get("is_active", True) else USER_STATUS_DISABLED


def is_user_active(user):
    return get_user_status(user) == USER_STATUS_ACTIVE


def serialize_user(user):
    role = get_user_role(user, current_app.config)
    status = get_user_status(user)
    created_at = user.get("created_at")
    last_login = user.get("last_login") or user.get("last_login_at")
    return {
        "id": str(user["_id"]),
        "username": user.get("username", ""),
        "email": user.get("email", ""),
        "role": role,
        "is_admin": role == ADMIN_ROLE,
        "status": status,
        "is_active": status == USER_STATUS_ACTIVE,
        "created_at": created_at.isoformat() if created_at else None,
        "last_login": last_login.isoformat() if last_login else None,
        "last_login_at": last_login.isoformat() if last_login else None,
        "profile_image": user.get("profile_image"),
    }


def _persist_user_role_if_needed(user):
    role = get_user_role(user, current_app.config)
    stored_role = str(user.get("role", "")).strip().lower()

    if stored_role == role:
        user["role"] = role
        return user

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    updated_at = datetime.now(timezone.utc)
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "role": role,
                "updated_at": updated_at,
            }
        },
    )
    user["role"] = role
    user["updated_at"] = updated_at
    return user


def _persist_user_status_if_needed(user):
    status = get_user_status(user)
    is_active = status == USER_STATUS_ACTIVE
    updates = {}

    if user.get("status") != status:
        updates["status"] = status

    if user.get("is_active", True) != is_active:
        updates["is_active"] = is_active

    if not updates:
        user["status"] = status
        user["is_active"] = is_active
        return user

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    updated_at = datetime.now(timezone.utc)
    updates["updated_at"] = updated_at
    users.update_one({"_id": user["_id"]}, {"$set": updates})
    user.update(updates)
    return user


def _persist_user_profile_fields_if_needed(user):
    updates = {}
    fallback_created_at = user.get("created_at") or user.get("updated_at") or datetime.now(timezone.utc)
    last_login = user.get("last_login") or user.get("last_login_at")

    if user.get("created_at") is None:
        updates["created_at"] = fallback_created_at

    if user.get("last_login") != last_login:
        updates["last_login"] = last_login

    if user.get("last_login_at") != last_login:
        updates["last_login_at"] = last_login

    if "profile_image" not in user:
        updates["profile_image"] = user.get("profile_image")

    if not updates:
        user["created_at"] = fallback_created_at
        user["last_login"] = last_login
        user["last_login_at"] = last_login
        user["profile_image"] = user.get("profile_image")
        return user

    updated_at = datetime.now(timezone.utc)
    updates["updated_at"] = updated_at

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    users.update_one({"_id": user["_id"]}, {"$set": updates})
    user.update(updates)
    return user


def _record_login_activity(user):
    logged_in_at = datetime.now(timezone.utc)

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "last_login": logged_in_at,
                "last_login_at": logged_in_at,
                "last_login_user_agent": request.headers.get("User-Agent", ""),
                "updated_at": logged_in_at,
            }
        },
    )
    record_activity(
        user={
            "id": str(user["_id"]),
            "username": user.get("username", ""),
            "email": user.get("email", ""),
            "role": get_user_role(user, current_app.config),
        },
        action_type="login",
        action_label="User logged in",
        details={
            "email": user.get("email", ""),
        },
    )


def get_current_user_from_request():
    # Temporary development-friendly auth approach:
    # until JWT or secure session cookies are added, the frontend sends the
    # logged-in user's MongoDB id in the X-User-Id header.
    user_id = request.headers.get("X-User-Id", "").strip()

    if not user_id:
        return None, jsonify({"success": False, "message": "Authenticated user ID is required."}), 401

    try:
        user_object_id = ObjectId(user_id)
    except InvalidId:
        return None, jsonify({"success": False, "message": "Authenticated user ID is invalid."}), 400

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    user = users.find_one({"_id": user_object_id})

    if not user:
        return None, jsonify({"success": False, "message": "Authenticated user was not found."}), 401

    user = _persist_user_profile_fields_if_needed(user)
    user = _persist_user_status_if_needed(user)

    if not is_user_active(user):
        return None, jsonify({"success": False, "message": "This account has been disabled. Contact an admin."}), 403

    return user, None, None


@auth_bp.post("/register")
def register():
    try:
        data = request.get_json(silent=True) or {}
        username = data.get("username", "").strip()
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not username or not email or not password:
            return jsonify({"success": False, "message": "Username, email, and password are required."}), 400

        if len(password) < 8:
            return jsonify({"success": False, "message": "Password must be at least 8 characters."}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        current_app.logger.info("Register route using users collection '%s'.", users.name)

        if users.find_one({"email": email}):
            return jsonify({"success": False, "message": "An account with this email already exists."}), 409

        created_at = datetime.now(timezone.utc)
        user_document = {
            "username": username,
            "email": email,
            "password_hash": generate_password_hash(password),
            "role": ADMIN_ROLE if is_bootstrap_admin_email(email, current_app.config) else PLAYER_ROLE,
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

        return jsonify(
            {
                "success": True,
                "message": "Account created successfully.",
                "user": serialize_user(created_user),
            }
        ), 201
    except DuplicateKeyError:
        return jsonify({"success": False, "message": "An account with this email already exists."}), 409
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during registration")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error during registration")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error during registration")
        return jsonify({"success": False, "message": "Registration failed. Please try again later."}), 500


@auth_bp.post("/login")
def login():
    try:
        data = request.get_json(silent=True) or {}
        email = data.get("email", "").strip().lower()
        password = data.get("password", "")

        if not email or not password:
            return jsonify({"success": False, "message": "Email and password are required."}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        current_app.logger.info("Login route using users collection '%s'.", users.name)
        user = users.find_one({"email": email})

        password_hash = user.get("password_hash") if user else None
        if not user or not password_hash or not check_password_hash(password_hash, password):
            return jsonify({"success": False, "message": "Invalid email or password."}), 401

        user = _persist_user_status_if_needed(user)
        user = _persist_user_profile_fields_if_needed(user)

        if not is_user_active(user):
            return jsonify({"success": False, "message": "This account has been disabled. Contact an admin."}), 403

        user = _persist_user_role_if_needed(user)
        _record_login_activity(user)

        return jsonify(
            {
                "success": True,
                "message": "Logged in successfully.",
                "user": serialize_user(user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during login")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error during login")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error during login")
        return jsonify({"success": False, "message": "Login failed. Please try again later."}), 500


@auth_bp.get("/me")
def me():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        user = _persist_user_role_if_needed(user)
        user = _persist_user_status_if_needed(user)
        user = _persist_user_profile_fields_if_needed(user)

        return jsonify(
            {
                "success": True,
                "message": "Current user loaded successfully.",
                "user": serialize_user(user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during current user lookup")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error during current user lookup")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error during current user lookup")
        return jsonify({"success": False, "message": "Could not load the current user."}), 500


__all__ = [
    "USER_STATUS_ACTIVE",
    "USER_STATUS_DISABLED",
    "VALID_USER_STATUSES",
    "auth_bp",
    "get_current_user_from_request",
    "get_user_status",
    "is_user_active",
    "serialize_user",
]
