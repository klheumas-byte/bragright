import re
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlsplit

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, g, jsonify, request
from pymongo.errors import DuplicateKeyError, PyMongoError
from werkzeug.security import check_password_hash, generate_password_hash

from ..db import describe_mongo_error, get_db_debug_snapshot, get_users_collection
from ..services.activity_logger import record_activity
from ..services.admin_access import ADMIN_ROLE, PLAYER_ROLE, get_user_role
from ..services.api_security import ErrorCode, api_error, get_json_object
from ..services.auth_sessions import (
    RefreshSessionError,
    create_refresh_session,
    get_active_session,
    revoke_refresh_token,
    revoke_session,
    revoke_token_family,
    rotate_refresh_session,
)
from ..services.auth_tokens import AccessTokenError, create_access_token, decode_access_token
from ..services.dtos import authentication_user_dto


auth_bp = Blueprint("auth", __name__)
USER_STATUS_ACTIVE = "active"
USER_STATUS_DISABLED = "disabled"
VALID_USER_STATUSES = {USER_STATUS_ACTIVE, USER_STATUS_DISABLED}
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_. -]+$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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
    return authentication_user_dto(user)


def _auth_error(message, status_code=401, code="invalid_authentication"):
    return api_error(message, status_code, code)


def _extract_bearer_token():
    authorization = str(request.headers.get("Authorization", "")).strip()
    if not authorization:
        return None

    scheme, separator, token = authorization.partition(" ")
    if not separator or scheme.lower() != "bearer" or not token.strip():
        return None
    return token.strip()


def _reject_untrusted_browser_origin():
    origin = str(request.headers.get("Origin", "")).strip().rstrip("/")
    if not origin:
        referer = str(request.headers.get("Referer", "")).strip()
        if referer:
            parsed_referer = urlsplit(referer)
            origin = f"{parsed_referer.scheme}://{parsed_referer.netloc}".rstrip("/")

    if not origin:
        return None

    allowed_origins = {
        str(value).strip().rstrip("/")
        for value in current_app.config.get("CORS_ORIGINS", [])
        if str(value).strip()
    }
    allowed_origins.add(request.host_url.rstrip("/"))
    if origin not in allowed_origins:
        return _auth_error(
            "Request origin is not allowed.",
            403,
            "untrusted_origin",
        )
    return None


def get_current_user_from_request():
    cached_user = getattr(g, "current_user", None)
    if cached_user is not None:
        return cached_user, None, None

    access_token = _extract_bearer_token()
    if not access_token:
        response, status = _auth_error(
            "Authentication is required.",
            401,
            "missing_access_token",
        )
        return None, response, status

    try:
        claims = decode_access_token(access_token)
    except AccessTokenError as error:
        response, status = _auth_error(str(error), 401, error.code)
        return None, response, status

    user_id = str(claims.get("sub", "")).strip()
    session_id = str(claims.get("sid", "")).strip()
    try:
        user_object_id = ObjectId(user_id)
    except (InvalidId, TypeError):
        response, status = _auth_error(
            "Access token is invalid.",
            401,
            "invalid_token_subject",
        )
        return None, response, status

    if not get_active_session(session_id, user_id=user_id):
        response, status = _auth_error(
            "This session is no longer active.",
            401,
            "session_revoked",
        )
        return None, response, status

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    user = users.find_one({"_id": user_object_id})
    if not user:
        response, status = _auth_error(
            "Authenticated account was not found.",
            401,
            "account_not_found",
        )
        return None, response, status

    if not is_user_active(user):
        revoke_session(session_id)
        response, status = _auth_error(
            "This account has been disabled. Contact an admin.",
            423,
            "account_disabled",
        )
        return None, response, status

    g.current_user = user
    g.access_token_claims = claims
    return user, None, None


def require_authentication(view_function):
    @wraps(view_function)
    def wrapped_view(*args, **kwargs):
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code
        g.current_user = user
        return view_function(*args, **kwargs)

    return wrapped_view


require_auth = require_authentication


def require_role(*allowed_roles):
    normalized_roles = {
        str(role).strip().lower()
        for role in allowed_roles
        if str(role).strip()
    }

    def decorator(view_function):
        @wraps(view_function)
        def wrapped_view(*args, **kwargs):
            user, error_response, status_code = get_current_user_from_request()
            if error_response:
                return error_response, status_code
            if get_user_role(user, current_app.config) not in normalized_roles:
                return _auth_error(
                    "You do not have permission to access this resource.",
                    403,
                    "insufficient_permissions",
                )
            g.current_user = user
            return view_function(*args, **kwargs)

        return wrapped_view

    return decorator


def require_admin(view_function):
    return require_role(ADMIN_ROLE)(view_function)


def require_player(view_function):
    return require_role(PLAYER_ROLE)(view_function)


def require_owner(owner_resolver, *, allow_admin=False):
    """Require a resource owner resolved from the authenticated user and route args."""

    def decorator(view_function):
        @wraps(view_function)
        def wrapped_view(*args, **kwargs):
            user, error_response, status_code = get_current_user_from_request()
            if error_response:
                return error_response, status_code

            if allow_admin and get_user_role(user, current_app.config) == ADMIN_ROLE:
                g.current_user = user
                return view_function(*args, **kwargs)

            if not owner_resolver(user, *args, **kwargs):
                return api_error(
                    "You do not have permission to access this resource.",
                    403,
                    ErrorCode.FORBIDDEN,
                )

            g.current_user = user
            return view_function(*args, **kwargs)

        return wrapped_view

    return decorator


def _record_login_activity(user):
    logged_in_at = datetime.now(timezone.utc)
    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "last_login": logged_in_at,
                "last_login_at": logged_in_at,
                "last_login_user_agent": str(request.headers.get("User-Agent", ""))[:512],
                "updated_at": logged_in_at,
            }
        },
    )
    user["last_login"] = logged_in_at
    user["last_login_at"] = logged_in_at
    user["updated_at"] = logged_in_at
    record_activity(
        user=serialize_user(user),
        action_type="login",
        action_label="User logged in",
        details={"email": user.get("email", "")},
    )


def _set_refresh_cookie(response, raw_refresh_token):
    response.set_cookie(
        current_app.config["REFRESH_COOKIE_NAME"],
        raw_refresh_token,
        max_age=current_app.config["REFRESH_TOKEN_DAYS"] * 24 * 60 * 60,
        httponly=True,
        secure=current_app.config["AUTH_COOKIE_SECURE"],
        samesite=current_app.config["AUTH_COOKIE_SAMESITE"],
        domain=current_app.config.get("AUTH_COOKIE_DOMAIN") or None,
        path="/api/auth",
    )


def _clear_refresh_cookie(response):
    response.delete_cookie(
        current_app.config["REFRESH_COOKIE_NAME"],
        httponly=True,
        secure=current_app.config["AUTH_COOKIE_SECURE"],
        samesite=current_app.config["AUTH_COOKIE_SAMESITE"],
        domain=current_app.config.get("AUTH_COOKIE_DOMAIN") or None,
        path="/api/auth",
    )


def _authenticated_response(user, message, status_code=200):
    refresh_session, raw_refresh_token = create_refresh_session(str(user["_id"]))
    response = jsonify(
        {
            "success": True,
            "message": message,
            "access_token": create_access_token(
                str(user["_id"]),
                refresh_session["session_id"],
            ),
            "expires_in": current_app.config["JWT_ACCESS_TOKEN_MINUTES"] * 60,
            "user": serialize_user(user),
        }
    )
    _set_refresh_cookie(response, raw_refresh_token)
    return response, status_code


def _validate_registration_payload(data):
    username = str(data.get("username", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))

    if not username or not email or not password:
        return None, "Username, email, and password are required."
    if len(username) < 3 or len(username) > 32 or not USERNAME_PATTERN.fullmatch(username):
        return None, (
            "Username must be 3 to 32 characters and use only letters, numbers, "
            "spaces, dots, underscores, or hyphens."
        )
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        return None, "Enter a valid email address."
    if len(password) < 8 or len(password) > 128:
        return None, "Password must be between 8 and 128 characters."
    return {"username": username, "email": email, "password": password}, None


@auth_bp.post("/register")
def register():
    origin_error = _reject_untrusted_browser_origin()
    if origin_error:
        return origin_error

    try:
        payload, body_error = get_json_object(
            allowed_fields={"username", "email", "password"}
        )
        if body_error:
            return body_error
        parsed, validation_error = _validate_registration_payload(payload)
        if validation_error:
            return jsonify({"success": False, "message": validation_error}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        if users.find_one({"email": parsed["email"]}):
            return jsonify({"success": False, "message": "An account with this email already exists."}), 409
        if users.find_one(
            {"username": re.compile(f"^{re.escape(parsed['username'])}$", re.IGNORECASE)}
        ):
            return jsonify({"success": False, "message": "That username is already in use."}), 409

        created_at = datetime.now(timezone.utc)
        user_document = {
            "username": parsed["username"],
            "email": parsed["email"],
            "password_hash": generate_password_hash(parsed["password"]),
            "role": PLAYER_ROLE,
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
        return _authenticated_response(
            created_user,
            "Account created successfully.",
            201,
        )
    except DuplicateKeyError:
        return jsonify({"success": False, "message": "An account with this email or username already exists."}), 409
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during registration")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config)
                if current_app.config.get("DEBUG")
                else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error during registration")
        return jsonify({"success": False, "message": str(error)}), 500
    except Exception:
        current_app.logger.exception("Unexpected error during registration")
        return jsonify({"success": False, "message": "Registration failed. Please try again later."}), 500


@auth_bp.post("/login")
def login():
    origin_error = _reject_untrusted_browser_origin()
    if origin_error:
        return origin_error

    try:
        data, body_error = get_json_object(
            allowed_fields={"email", "password"}
        )
        if body_error:
            return body_error
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))
        if not email or not password:
            return jsonify({"success": False, "message": "Email and password are required."}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        user = users.find_one({"email": email})
        password_hash = user.get("password_hash") if user else None
        if not user or not password_hash or not check_password_hash(password_hash, password):
            return jsonify({"success": False, "message": "Invalid email or password."}), 401
        if not is_user_active(user):
            return _auth_error(
                "This account has been disabled. Contact an admin.",
                423,
                "account_disabled",
            )

        _record_login_activity(user)
        return _authenticated_response(user, "Logged in successfully.")
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during login")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config)
                if current_app.config.get("DEBUG")
                else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error during login")
        return jsonify({"success": False, "message": str(error)}), 500
    except Exception:
        current_app.logger.exception("Unexpected error during login")
        return jsonify({"success": False, "message": "Login failed. Please try again later."}), 500


@auth_bp.post("/refresh")
def refresh():
    origin_error = _reject_untrusted_browser_origin()
    if origin_error:
        return origin_error

    raw_refresh_token = request.cookies.get(
        current_app.config["REFRESH_COOKIE_NAME"],
        "",
    )
    if not raw_refresh_token:
        response, status = _auth_error(
            "Refresh session is required.",
            401,
            "missing_refresh_token",
        )
        _clear_refresh_cookie(response)
        return response, status

    try:
        refresh_session, new_raw_refresh_token = rotate_refresh_session(raw_refresh_token)
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        try:
            user_object_id = ObjectId(refresh_session["user_id"])
        except (InvalidId, TypeError) as error:
            revoke_token_family(refresh_session["family_id"])
            raise RefreshSessionError("Refresh session is invalid.") from error

        user = users.find_one({"_id": user_object_id})
        if not user:
            revoke_token_family(refresh_session["family_id"])
            response, status = _auth_error(
                "Authenticated account was not found.",
                401,
                "account_not_found",
            )
            _clear_refresh_cookie(response)
            return response, status
        if not is_user_active(user):
            revoke_token_family(refresh_session["family_id"])
            response, status = _auth_error(
                "This account has been disabled. Contact an admin.",
                423,
                "account_disabled",
            )
            _clear_refresh_cookie(response)
            return response, status

        response = jsonify(
            {
                "success": True,
                "message": "Session refreshed successfully.",
                "access_token": create_access_token(
                    str(user["_id"]),
                    refresh_session["session_id"],
                ),
                "expires_in": current_app.config["JWT_ACCESS_TOKEN_MINUTES"] * 60,
                "user": serialize_user(user),
            }
        )
        _set_refresh_cookie(response, new_raw_refresh_token)
        return response, 200
    except RefreshSessionError as error:
        response, status = _auth_error(str(error), error.status_code, error.code)
        _clear_refresh_cookie(response)
        return response, status
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during session refresh")
        return jsonify({"success": False, "message": describe_mongo_error(error)}), 500
    except Exception:
        current_app.logger.exception("Unexpected error during session refresh")
        return jsonify({"success": False, "message": "Could not refresh the session."}), 500


@auth_bp.get("/me")
@require_auth
def me():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code
        return jsonify(
            {
                "success": True,
                "message": "Current user loaded successfully.",
                "user": serialize_user(user),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error during current user lookup")
        return jsonify({"success": False, "message": describe_mongo_error(error)}), 500
    except Exception:
        current_app.logger.exception("Unexpected error during current user lookup")
        return jsonify({"success": False, "message": "Could not load the current user."}), 500


@auth_bp.post("/logout")
def logout():
    origin_error = _reject_untrusted_browser_origin()
    if origin_error:
        return origin_error

    raw_refresh_token = request.cookies.get(
        current_app.config["REFRESH_COOKIE_NAME"],
        "",
    )
    if raw_refresh_token:
        revoke_refresh_token(raw_refresh_token)

    access_token = _extract_bearer_token()
    if access_token:
        try:
            claims = decode_access_token(access_token)
            revoke_session(claims["sid"])
        except AccessTokenError:
            pass

    response = jsonify(
        {
            "success": True,
            "message": "Logged out successfully.",
        }
    )
    _clear_refresh_cookie(response)
    return response, 200


__all__ = [
    "USER_STATUS_ACTIVE",
    "USER_STATUS_DISABLED",
    "VALID_USER_STATUSES",
    "auth_bp",
    "get_current_user_from_request",
    "get_user_status",
    "is_user_active",
    "require_auth",
    "require_admin",
    "require_authentication",
    "require_owner",
    "require_player",
    "require_role",
    "serialize_user",
]
