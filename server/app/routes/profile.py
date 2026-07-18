import base64
import binascii
import re
from datetime import datetime, timezone

from flask import Blueprint, current_app, jsonify, request
from pymongo.errors import PyMongoError

from ..db import describe_mongo_error, get_db_debug_snapshot, get_matches_collection, get_users_collection
from .auth import get_current_user_from_request, require_player, serialize_user
from ..services.api_security import (
    get_json_object,
    pagination_metadata,
    parse_bounded_int_query,
)
from ..services.activity_logger import record_activity
from ..services.dtos import player_private_dto
from ..services.player_profile_service import (
    build_profile_overview,
    get_matches_for_user,
    resolve_match_view_for_user,
)


profile_bp = Blueprint("profile", __name__)
MAX_PROFILE_IMAGE_LENGTH = 240_000
ALLOWED_PROFILE_IMAGE_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)
DEFAULT_PROFILE_MATCHES_LIMIT = 25
MAX_PROFILE_MATCHES_LIMIT = 100


def _load_current_user():
    user, error_response, status_code = get_current_user_from_request()
    if error_response:
        return None, error_response, status_code

    return user, None, None


def _serialize_profile(user_document, overview=None):
    serialized_user = player_private_dto(user_document)
    return {
        "id": serialized_user["id"],
        "username": serialized_user.get("username", ""),
        "email": serialized_user.get("email", ""),
        "role": serialized_user.get("role", "player"),
        "status": serialized_user.get("status", "active"),
        "profile_image": serialized_user.get("profile_image") or "",
        "created_at": serialized_user.get("created_at"),
        "overview": overview or {
            "total_matches": 0,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "pending_matches": 0,
            "disputed_matches": 0,
            "recent_summary": [],
        },
    }


def _sanitize_username(value):
    username = str(value or "").strip()

    if not username:
        return None, "Username is required."

    if len(username) < 3:
        return None, "Username must be at least 3 characters."

    if len(username) > 32:
        return None, "Username must be 32 characters or fewer."

    if not re.fullmatch(r"[A-Za-z0-9_. -]+", username):
        return None, "Username can only contain letters, numbers, spaces, dots, underscores, and hyphens."

    return username, None


def _sanitize_profile_image(image_value):
    if image_value is None:
        return None, None

    image_string = str(image_value).strip()
    if not image_string:
        return "", None

    if len(image_string) > MAX_PROFILE_IMAGE_LENGTH:
        return None, "Profile image is too large."

    if not image_string.startswith(ALLOWED_PROFILE_IMAGE_PREFIXES):
        return None, "Profile image must be a PNG, JPEG, or WebP base64 data URL."

    encoded_content = image_string.split(",", 1)[1]
    try:
        decoded_content = base64.b64decode(encoded_content, validate=True)
    except (binascii.Error, ValueError):
        return None, "Profile image data is not valid base64."

    if not decoded_content:
        return None, "Profile image data cannot be empty."

    if not _profile_image_signature_matches(image_string, decoded_content):
        return None, "Profile image content does not match its PNG, JPEG, or WebP type."

    return image_string, None


def _profile_image_signature_matches(image_string, content):
    if image_string.startswith("data:image/png;"):
        return content.startswith(b"\x89PNG\r\n\x1a\n")

    if image_string.startswith("data:image/jpeg;"):
        return content.startswith(b"\xff\xd8\xff")

    if image_string.startswith("data:image/webp;"):
        return len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP"

    return False


def _load_overview_for_user(user_id):
    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
    match_documents = get_matches_for_user(user_id, matches)
    return build_profile_overview(match_documents, user_id)


def _parse_limit_arg(default_limit=DEFAULT_PROFILE_MATCHES_LIMIT, max_limit=MAX_PROFILE_MATCHES_LIMIT):
    return parse_bounded_int_query(
        "limit",
        default=default_limit,
        maximum=max_limit,
    )


@profile_bp.get("/me")
@require_player
def get_my_profile():
    try:
        user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        return jsonify(
            {
                "success": True,
                "data": _serialize_profile(user, _load_overview_for_user(str(user["_id"]))),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading profile summary")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading profile summary")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading profile summary")
        return jsonify({"success": False, "message": "Could not load your profile."}), 500


@profile_bp.post("/update")
@require_player
def update_profile():
    try:
        user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        payload, body_error = get_json_object(
            allowed_fields={"username", "image"}
        )
        if body_error:
            return body_error
        user_object_id = user["_id"]

        next_username, username_error = _sanitize_username(payload.get("username"))
        if username_error:
            return jsonify({"success": False, "message": username_error}), 400

        next_image, image_error = _sanitize_profile_image(payload.get("image"))
        if image_error:
            return jsonify({"success": False, "message": image_error}), 400

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        existing_user = users.find_one({"_id": user_object_id})

        if not existing_user:
            return jsonify({"success": False, "message": "User not found."}), 404

        username_regex = re.compile(f"^{re.escape(next_username)}$", re.IGNORECASE)
        username_conflict = users.find_one(
            {
                "_id": {"$ne": user_object_id},
                "username": username_regex,
            }
        )
        if username_conflict:
            return jsonify({"success": False, "message": "That username is already in use."}), 409

        updated_at = datetime.now(timezone.utc)
        updates = {
            "username": next_username,
            "profile_image": next_image if next_image is not None else existing_user.get("profile_image") or "",
            "updated_at": updated_at,
        }

        users.update_one({"_id": user_object_id}, {"$set": updates})
        updated_user = users.find_one({"_id": user_object_id}) or {**existing_user, **updates}

        record_activity(
            user=serialize_user(updated_user),
            action_type="profile_updated",
            action_label="Profile updated",
            details={
                "previous_username": existing_user.get("username", ""),
                "next_username": updates["username"],
                "profile_image_updated": updates["profile_image"] != (existing_user.get("profile_image") or ""),
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "Profile updated successfully.",
                "data": _serialize_profile(updated_user, _load_overview_for_user(str(updated_user["_id"]))),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while updating profile")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while updating profile")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while updating profile")
        return jsonify({"success": False, "message": "Could not update your profile."}), 500


@profile_bp.patch("/me")
@require_player
def update_my_profile_alias():
    return update_profile()


@profile_bp.get("/me/matches")
@require_player
def get_my_profile_matches():
    try:
        user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        limit, limit_error = _parse_limit_arg()
        if limit_error:
            return limit_error
        page, page_error = parse_bounded_int_query(
            "page", default=1, maximum=100000
        )
        if page_error:
            return page_error
        user_id = str(user["_id"])
        match_query = {
            "$or": [
                {"player_one_id": user_id},
                {"player_two_id": user_id},
                {"submitted_by": user_id},
                {"opponent_id": user_id},
            ]
        }
        total = matches.count_documents(match_query)
        match_documents = get_matches_for_user(
            user_id,
            matches,
            limit=limit,
            skip=(page - 1) * limit,
        )
        serialized_matches = [
            resolve_match_view_for_user(match_document, str(user["_id"]))
            for match_document in match_documents
        ]

        return jsonify(
            {
                "success": True,
                "data": {
                    "matches": serialized_matches,
                    **pagination_metadata(page=page, limit=limit, total=total),
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading profile matches")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading profile matches")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading profile matches")
        return jsonify({"success": False, "message": "Could not load your matches."}), 500
