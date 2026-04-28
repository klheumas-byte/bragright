import re
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from pymongo.errors import PyMongoError

from ..db import describe_mongo_error, get_db_debug_snapshot, get_matches_collection, get_users_collection
from .auth import get_current_user_from_request, serialize_user
from ..services.activity_logger import record_activity
from ..services.player_profile_service import (
    build_profile_overview,
    get_matches_for_user,
    resolve_match_view_for_user,
)


profile_bp = Blueprint("profile", __name__)
MAX_PROFILE_IMAGE_LENGTH = 2_000_000


def _load_current_user():
    user, error_response, status_code = get_current_user_from_request()
    if error_response:
        return None, error_response, status_code

    return user, None, None


def _serialize_profile(user_document, overview=None):
    serialized_user = serialize_user(user_document)
    return {
        "id": serialized_user["id"],
        "username": serialized_user.get("username", ""),
        "email": serialized_user.get("email", ""),
        "profile_image": serialized_user.get("profile_image") or "",
        "created_at": serialized_user.get("created_at"),
        "last_login": serialized_user.get("last_login"),
        "last_login_at": serialized_user.get("last_login"),
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

    if not image_string.startswith("data:image/"):
        return None, "Profile image must be a valid base64 data URL."

    return image_string, None


def _load_overview_for_user(user_id):
    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
    match_documents = get_matches_for_user(user_id, matches)
    return build_profile_overview(match_documents, user_id)


@profile_bp.get("/me")
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
def update_profile():
    try:
        user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        payload = request.get_json(silent=True) or {}
        user_id = str(payload.get("user_id", "")).strip()

        if not user_id:
            return jsonify({"success": False, "message": "User ID is required."}), 400

        if user_id != str(user["_id"]):
            return jsonify({"success": False, "message": "You can only update your own profile."}), 403

        try:
            user_object_id = ObjectId(user_id)
        except InvalidId:
            return jsonify({"success": False, "message": "User ID is invalid."}), 400

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
def update_my_profile_alias():
    return update_profile()


@profile_bp.get("/me/matches")
def get_my_profile_matches():
    try:
        user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        match_documents = get_matches_for_user(str(user["_id"]), matches, limit=25)
        serialized_matches = [
            resolve_match_view_for_user(match_document, str(user["_id"]))
            for match_document in match_documents
        ]

        return jsonify(
            {
                "success": True,
                "data": {
                    "matches": serialized_matches,
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
