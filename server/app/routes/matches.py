from datetime import timedelta
from pathlib import Path
from uuid import uuid4

from flask import Blueprint, current_app, jsonify, request, send_from_directory
from pymongo import DESCENDING
from pymongo.errors import PyMongoError
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from ..db import (
    describe_mongo_error,
    get_db_debug_snapshot,
    get_matches_collection,
    get_users_collection,
)
from ..services.activity_logger import record_activity
from ..services.match_workflow import (
    MATCH_RESULT_SOURCE_ADMIN,
    MATCH_STATUS_MATCH_REQUESTED,
    MATCH_RESULT_SOURCE_PLAYER,
    MATCH_STATUS_CANCELLED,
    MATCH_STATUS_CONFIRMED,
    MATCH_STATUS_DISPUTED,
    MATCH_STATUS_EXPIRED,
    MATCH_STATUS_PENDING_CONFIRMATION,
    MATCH_STATUS_PENDING_RESULT,
    build_invalid_transition_error,
    calculate_winner_id,
    format_match_status,
    get_match_opponent_id,
    get_match_participant_role,
    is_valid_transition,
    now_utc,
    parse_object_id,
    resolve_actionable_status,
    resolve_match_players,
    serialize_match,
    validate_scores_and_winner,
    group_matches_by_status,
)
from ..services.system_settings import get_match_duplicate_window_minutes
from .auth import get_current_user_from_request, serialize_user


matches_bp = Blueprint("matches", __name__)
ALLOWED_PROOF_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
ALLOWED_PROOF_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_PROOF_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
PROOF_UPLOAD_DIRECTORY = Path(__file__).resolve().parents[1] / "uploads" / "proofs"


def _json_error(message, status_code=400, **extra):
    return jsonify({"success": False, "message": message, **extra}), status_code


def _load_current_user():
    user, error_response, status_code = get_current_user_from_request()
    if error_response:
        return None, error_response, status_code
    return user, None, None


def _load_user_by_id(user_id):
    normalized_id, object_id = parse_object_id(user_id)
    if not normalized_id or not object_id:
        return None, "User ID is invalid.", 400

    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    user = users.find_one({"_id": object_id})
    if not user:
        return None, "User was not found.", 404

    return user, None, None


def _load_match(match_id):
    normalized_id, object_id = parse_object_id(match_id)
    if not normalized_id or not object_id:
        return None, None, _json_error("Match ID is invalid.", 400)

    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
    match = matches.find_one({"_id": object_id})
    if not match:
        return None, None, _json_error("Match not found.", 404)

    return match, matches, None


def _ensure_user_in_match(match_document, user_id):
    if get_match_participant_role(match_document, user_id) == "viewer":
        return _json_error("You are not part of this match.", 403)
    return None


def _ensure_transition(match_document, next_status):
    current_status = resolve_actionable_status(match_document)
    if not is_valid_transition(current_status, next_status):
        payload = build_invalid_transition_error(current_status, next_status)
        return jsonify(payload), 400
    return None


def _ensure_admin_or_participant(user_document, match_document):
    role = str(user_document.get("role", "")).strip().lower()
    if role == "admin":
        return None
    return _ensure_user_in_match(match_document, str(user_document["_id"]))


def _ensure_request_recipient(match_document, user_id):
    requested_to = match_document.get("requested_to") or match_document.get("player_two_id")
    if requested_to != user_id:
        return _json_error("Only the requested opponent can perform this action.", 403)
    return None


def _parse_schedule_payload(payload):
    opponent_id = str(payload.get("opponent_id", "")).strip()
    opponent_username = str(payload.get("opponent_username", "")).strip()

    if not opponent_id and not opponent_username:
        return None, "Opponent is required."

    return {"opponent_id": opponent_id, "opponent_username": opponent_username}, None


def _parse_submit_result_payload(match_document, payload):
    validated, validation_error = validate_scores_and_winner(
        match_document,
        payload.get("player_one_score"),
        payload.get("player_two_score"),
        payload.get("winner_id"),
    )
    if validation_error:
        return None, validation_error

    proof_image_url = str(payload.get("proof_image_url", "")).strip() or None
    return {
        **validated,
        "proof_image_url": proof_image_url,
    }, None


def _parse_dispute_payload(payload):
    dispute_note = str(payload.get("dispute_note", "")).strip()
    if not dispute_note:
        return None, "Dispute note is required."
    if len(dispute_note) > 500:
        return None, "Dispute note must be 500 characters or fewer."
    return {"dispute_note": dispute_note}, None


def _find_duplicate_match(player_one_id, player_two_id):
    duplicate_window_minutes = get_match_duplicate_window_minutes()
    cutoff_time = now_utc() - timedelta(minutes=duplicate_window_minutes)
    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)

    duplicate = matches.find_one(
        {
            "$or": [
                {"player_one_id": player_one_id, "player_two_id": player_two_id},
                {"player_one_id": player_two_id, "player_two_id": player_one_id},
                {"submitted_by": player_one_id, "opponent_id": player_two_id},
            ],
            "status": {
                "$in": [
                    MATCH_STATUS_MATCH_REQUESTED,
                    MATCH_STATUS_PENDING_RESULT,
                    MATCH_STATUS_PENDING_CONFIRMATION,
                    MATCH_STATUS_DISPUTED,
                ]
            },
            "created_at": {"$gte": cutoff_time},
        },
        sort=[("created_at", DESCENDING)],
    )
    return duplicate, duplicate_window_minutes


def _validate_and_store_proof_image(uploaded_file: FileStorage):
    if not uploaded_file or not uploaded_file.filename:
        return None, "Proof image file is required."

    original_filename = secure_filename(uploaded_file.filename)
    if not original_filename:
        return None, "Proof image filename is invalid."

    file_extension = original_filename.rsplit(".", 1)[-1].lower() if "." in original_filename else ""
    if file_extension not in ALLOWED_PROOF_EXTENSIONS:
        return None, "Proof image must be a PNG, JPG, JPEG, or WEBP file."

    if uploaded_file.mimetype not in ALLOWED_PROOF_MIME_TYPES:
        return None, "Proof image type is not supported."

    file_bytes = uploaded_file.read()
    uploaded_file.stream.seek(0)

    if not file_bytes:
        return None, "Proof image file is empty."

    if len(file_bytes) > MAX_PROOF_IMAGE_SIZE_BYTES:
        return None, "Proof image must be 5 MB or smaller."

    PROOF_UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    stored_filename = f"{uuid4().hex}.{file_extension}"
    destination_path = PROOF_UPLOAD_DIRECTORY / stored_filename
    uploaded_file.save(destination_path)
    return stored_filename, None


def _build_proof_image_url(filename):
    return f"/api/matches/proof/{filename}"


@matches_bp.post("/upload-proof")
def upload_proof():
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        uploaded_file = request.files.get("proof_image")
        stored_filename, validation_error = _validate_and_store_proof_image(uploaded_file)
        if validation_error:
            return _json_error(validation_error, 400)

        proof_image_url = _build_proof_image_url(stored_filename)
        record_activity(
            user=serialize_user(current_user),
            action_type="proof_uploaded",
            action_label="Match proof uploaded",
            details={"proof_image_url": proof_image_url},
        )

        return jsonify(
            {
                "success": True,
                "message": "Proof image uploaded successfully.",
                "data": {
                    "proof_image_url": proof_image_url,
                    "uploaded_by": str(current_user["_id"]),
                },
            }
        ), 201
    except OSError:
        current_app.logger.exception("Filesystem error while uploading proof image")
        return _json_error("Could not store the proof image.", 500)
    except Exception:
        current_app.logger.exception("Unexpected error while uploading proof image")
        return _json_error("Could not upload the proof image.", 500)


@matches_bp.get("/proof/<filename>")
def serve_uploaded_proof(filename):
    safe_filename = secure_filename(filename)
    if not safe_filename:
        return _json_error("Proof image file was not found.", 404)

    proof_path = PROOF_UPLOAD_DIRECTORY / safe_filename
    if not proof_path.exists():
        return _json_error("Proof image file was not found.", 404)

    return send_from_directory(PROOF_UPLOAD_DIRECTORY, safe_filename)


@matches_bp.post("")
@matches_bp.post("/schedule")
def schedule_match():
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        payload = request.get_json(silent=True) or {}
        parsed_payload, validation_error = _parse_schedule_payload(payload)
        if validation_error:
            return _json_error(validation_error, 400)

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        opponent = None

        if parsed_payload["opponent_id"]:
            if parsed_payload["opponent_id"] == str(current_user["_id"]):
                return _json_error("You cannot create a match against yourself.", 400)

            opponent, opponent_error, opponent_status = _load_user_by_id(parsed_payload["opponent_id"])
            if opponent_error:
                return _json_error(opponent_error, opponent_status)
        else:
            opponent = users.find_one({"username": parsed_payload["opponent_username"]})
            if not opponent:
                opponent = users.find_one({"email": parsed_payload["opponent_username"].lower()})
            if not opponent:
                return _json_error("Opponent not found.", 404)
            if str(opponent["_id"]) == str(current_user["_id"]):
                return _json_error("You cannot create a match against yourself.", 400)

        duplicate, duplicate_window_minutes = _find_duplicate_match(
            str(current_user["_id"]),
            str(opponent["_id"]),
        )
        if duplicate:
            return _json_error(
                (
                    "A similar match already exists within the duplicate protection window. "
                    f"Wait {duplicate_window_minutes} minutes before creating another one."
                ),
                409,
            )

        created_at = now_utc()
        match_document = {
            "player_one_id": str(current_user["_id"]),
            "player_two_id": str(opponent["_id"]),
            "player_one_name": current_user.get("username") or current_user.get("email") or "Player one",
            "player_two_name": opponent.get("username") or opponent.get("email") or "Player two",
            "created_by": str(current_user["_id"]),
            "requested_to": str(opponent["_id"]),
            "result_submitted_by": None,
            "confirmed_by": None,
            "disputed_by": None,
            "reviewed_by": None,
            "status": MATCH_STATUS_MATCH_REQUESTED,
            "previous_status": None,
            "player_one_score": None,
            "player_two_score": None,
            "winner_id": None,
            "result_source": MATCH_RESULT_SOURCE_PLAYER,
            "proof_image_url": None,
            "dispute_note": None,
            "resolution_note": None,
            "resolution_action": None,
            "created_at": created_at,
            "accepted_at": None,
            "declined_at": None,
            "result_submitted_at": None,
            "confirmed_at": None,
            "disputed_at": None,
            "reviewed_at": None,
            "cancelled_at": None,
            "expired_at": None,
            "updated_at": created_at,
            "submitted_by": str(current_user["_id"]),
            "submitted_by_name": current_user.get("username") or current_user.get("email") or "Player one",
            "opponent_id": str(opponent["_id"]),
            "opponent_name": opponent.get("username") or opponent.get("email") or "Player two",
        }

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        result = matches.insert_one(match_document)
        created_match = matches.find_one({"_id": result.inserted_id})

        record_activity(
            user=serialize_user(current_user),
            action_type="match_scheduled",
            action_label="Match scheduled",
            details={
                "match_id": str(result.inserted_id),
                "opponent_id": str(opponent["_id"]),
                "status": MATCH_STATUS_MATCH_REQUESTED,
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "Match request sent successfully and is now waiting for your opponent to accept or decline it.",
                "match": serialize_match(created_match, str(current_user["_id"])),
                "data": serialize_match(created_match, str(current_user["_id"])),
            }
        ), 201
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while scheduling a match")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while scheduling a match")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while scheduling a match")
        return _json_error("Could not schedule the match.", 500)


@matches_bp.post("/<match_id>/submit-result")
def submit_match_result(match_id):
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        match, matches, load_error = _load_match(match_id)
        if load_error:
            return load_error

        membership_error = _ensure_user_in_match(match, str(current_user["_id"]))
        if membership_error:
            return membership_error

        transition_error = _ensure_transition(match, MATCH_STATUS_PENDING_CONFIRMATION)
        if transition_error:
            return transition_error

        payload = request.get_json(silent=True) or {}
        parsed_payload, validation_error = _parse_submit_result_payload(match, payload)
        if validation_error:
            return _json_error(validation_error, 400)

        submitted_at = now_utc()
        updated_fields = {
            "previous_status": match.get("status"),
            "status": MATCH_STATUS_PENDING_CONFIRMATION,
            "player_one_score": parsed_payload["player_one_score"],
            "player_two_score": parsed_payload["player_two_score"],
            "winner_id": parsed_payload["winner_id"],
            "proof_image_url": parsed_payload["proof_image_url"],
            "result_source": MATCH_RESULT_SOURCE_PLAYER,
            "result_submitted_by": str(current_user["_id"]),
            "result_submitted_at": submitted_at,
            "confirmed_by": None,
            "disputed_by": None,
            "reviewed_by": None,
            "dispute_note": None,
            "resolution_note": None,
            "resolution_action": None,
            "confirmed_at": None,
            "disputed_at": None,
            "reviewed_at": None,
            "updated_at": submitted_at,
        }

        matches.update_one({"_id": match["_id"]}, {"$set": updated_fields})
        updated_match = matches.find_one({"_id": match["_id"]})

        record_activity(
            user=serialize_user(current_user),
            action_type="result_submitted",
            action_label="Result submitted",
            details={
                "match_id": str(match["_id"]),
                "player_one_score": parsed_payload["player_one_score"],
                "player_two_score": parsed_payload["player_two_score"],
                "winner_id": parsed_payload["winner_id"],
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "Match result submitted and is now waiting for opponent confirmation.",
                "match": serialize_match(updated_match, str(current_user["_id"])),
                "data": serialize_match(updated_match, str(current_user["_id"])),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while submitting match result")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while submitting match result")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while submitting match result")
        return _json_error("Could not submit the match result.", 500)


@matches_bp.post("/<match_id>/accept")
def accept_match(match_id):
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        match, matches, load_error = _load_match(match_id)
        if load_error:
            return load_error

        membership_error = _ensure_user_in_match(match, str(current_user["_id"]))
        if membership_error:
            return membership_error

        recipient_error = _ensure_request_recipient(match, str(current_user["_id"]))
        if recipient_error:
            return recipient_error

        current_status = resolve_actionable_status(match)
        if current_status == MATCH_STATUS_PENDING_RESULT:
            serialized_match = serialize_match(match, str(current_user["_id"]))
            return jsonify(
                {
                    "success": True,
                    "message": "Match already accepted and ready for result submission.",
                    "match": serialized_match,
                    "data": serialized_match,
                }
            ), 200

        transition_error = _ensure_transition(match, MATCH_STATUS_PENDING_RESULT)
        if transition_error:
            return transition_error

        accepted_at = now_utc()
        matches.update_one(
            {"_id": match["_id"]},
            {
                "$set": {
                    "previous_status": match.get("status"),
                    "status": MATCH_STATUS_PENDING_RESULT,
                    "accepted_at": accepted_at,
                    "declined_at": None,
                    "updated_at": accepted_at,
                }
            },
        )
        updated_match = matches.find_one({"_id": match["_id"]})

        record_activity(
            user=serialize_user(current_user),
            action_type="match_request_accepted",
            action_label="Match request accepted",
            details={"match_id": str(match["_id"])},
        )

        serialized_match = serialize_match(updated_match, str(current_user["_id"]))
        return jsonify(
            {
                "success": True,
                "message": "Match accepted successfully. This match is now ready for result submission.",
                "match": serialized_match,
                "data": serialized_match,
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while accepting a match request")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while accepting a match request")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while accepting a match request")
        return _json_error("Could not accept the match request.", 500)


@matches_bp.post("/<match_id>/decline")
def decline_match(match_id):
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        match, matches, load_error = _load_match(match_id)
        if load_error:
            return load_error

        membership_error = _ensure_user_in_match(match, str(current_user["_id"]))
        if membership_error:
            return membership_error

        recipient_error = _ensure_request_recipient(match, str(current_user["_id"]))
        if recipient_error:
            return recipient_error

        transition_error = _ensure_transition(match, MATCH_STATUS_CANCELLED)
        if transition_error:
            return transition_error

        declined_at = now_utc()
        matches.update_one(
            {"_id": match["_id"]},
            {
                "$set": {
                    "previous_status": match.get("status"),
                    "status": MATCH_STATUS_CANCELLED,
                    "declined_at": declined_at,
                    "cancelled_at": declined_at,
                    "updated_at": declined_at,
                }
            },
        )
        updated_match = matches.find_one({"_id": match["_id"]})

        record_activity(
            user=serialize_user(current_user),
            action_type="match_request_declined",
            action_label="Match request declined",
            details={"match_id": str(match["_id"])},
        )

        serialized_match = serialize_match(updated_match, str(current_user["_id"]))
        return jsonify(
            {
                "success": True,
                "message": "Match declined successfully.",
                "match": serialized_match,
                "data": serialized_match,
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while declining a match request")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while declining a match request")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while declining a match request")
        return _json_error("Could not decline the match request.", 500)


@matches_bp.get("/my")
def get_my_matches():
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        documents = list(
            matches.find(
                {
                    "$or": [
                        {"player_one_id": str(current_user["_id"])},
                        {"player_two_id": str(current_user["_id"])},
                        {"submitted_by": str(current_user["_id"])},
                        {"opponent_id": str(current_user["_id"])},
                    ]
                }
            ).sort("updated_at", DESCENDING)
        )
        serialized_matches = [serialize_match(document, str(current_user["_id"])) for document in documents]
        grouped = group_matches_by_status(serialized_matches)

        return jsonify(
            {
                "success": True,
                "message": "Matches loaded successfully.",
                "matches": serialized_matches,
                "data": grouped,
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading matches")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading matches")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading matches")
        return _json_error("Could not load matches.", 500)


@matches_bp.post("/<match_id>/confirm")
@matches_bp.patch("/<match_id>/confirm")
def confirm_match(match_id):
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        match, matches, load_error = _load_match(match_id)
        if load_error:
            return load_error

        membership_error = _ensure_user_in_match(match, str(current_user["_id"]))
        if membership_error:
            return membership_error

        if match.get("result_submitted_by") == str(current_user["_id"]):
            return _json_error("You cannot confirm your own submitted result.", 403)

        transition_error = _ensure_transition(match, MATCH_STATUS_CONFIRMED)
        if transition_error:
            return transition_error

        confirmed_at = now_utc()
        updated_fields = {
            "previous_status": match.get("status"),
            "status": MATCH_STATUS_CONFIRMED,
            "confirmed_by": str(current_user["_id"]),
            "confirmed_at": confirmed_at,
            "updated_at": confirmed_at,
        }

        matches.update_one({"_id": match["_id"]}, {"$set": updated_fields})
        updated_match = matches.find_one({"_id": match["_id"]})

        record_activity(
            user=serialize_user(current_user),
            action_type="match_confirmed",
            action_label="Match confirmed",
            details={"match_id": str(match["_id"])},
        )

        return jsonify(
            {
                "success": True,
                "message": "Match confirmed successfully.",
                "match": serialize_match(updated_match, str(current_user["_id"])),
                "data": serialize_match(updated_match, str(current_user["_id"])),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while confirming a match")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while confirming a match")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while confirming a match")
        return _json_error("Could not confirm the match.", 500)


@matches_bp.post("/<match_id>/dispute")
@matches_bp.patch("/<match_id>/dispute")
def dispute_match(match_id):
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        match, matches, load_error = _load_match(match_id)
        if load_error:
            return load_error

        membership_error = _ensure_user_in_match(match, str(current_user["_id"]))
        if membership_error:
            return membership_error

        if match.get("result_submitted_by") == str(current_user["_id"]):
            return _json_error("You cannot dispute your own submitted result.", 403)

        transition_error = _ensure_transition(match, MATCH_STATUS_DISPUTED)
        if transition_error:
            return transition_error

        payload = request.get_json(silent=True) or {}
        parsed_payload, validation_error = _parse_dispute_payload(payload)
        if validation_error:
            return _json_error(validation_error, 400)

        disputed_at = now_utc()
        updated_fields = {
            "previous_status": match.get("status"),
            "status": MATCH_STATUS_DISPUTED,
            "disputed_by": str(current_user["_id"]),
            "disputed_at": disputed_at,
            "dispute_note": parsed_payload["dispute_note"],
            "updated_at": disputed_at,
        }

        matches.update_one({"_id": match["_id"]}, {"$set": updated_fields})
        updated_match = matches.find_one({"_id": match["_id"]})

        record_activity(
            user=serialize_user(current_user),
            action_type="match_disputed",
            action_label="Match disputed",
            details={
                "match_id": str(match["_id"]),
                "dispute_note": parsed_payload["dispute_note"],
            },
        )

        return jsonify(
            {
                "success": True,
                "message": "Match disputed successfully and is now waiting for admin review.",
                "match": serialize_match(updated_match, str(current_user["_id"])),
                "data": serialize_match(updated_match, str(current_user["_id"])),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while disputing a match")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while disputing a match")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while disputing a match")
        return _json_error("Could not dispute the match.", 500)


@matches_bp.post("/<match_id>/cancel")
def cancel_match(match_id):
    try:
        current_user, error_response, status_code = _load_current_user()
        if error_response:
            return error_response, status_code

        match, matches, load_error = _load_match(match_id)
        if load_error:
            return load_error

        permission_error = _ensure_admin_or_participant(current_user, match)
        if permission_error:
            return permission_error

        transition_error = _ensure_transition(match, MATCH_STATUS_CANCELLED)
        if transition_error:
            return transition_error

        cancelled_at = now_utc()
        matches.update_one(
            {"_id": match["_id"]},
            {
                "$set": {
                    "previous_status": match.get("status"),
                    "status": MATCH_STATUS_CANCELLED,
                    "cancelled_at": cancelled_at,
                    "updated_at": cancelled_at,
                }
            },
        )
        updated_match = matches.find_one({"_id": match["_id"]})

        record_activity(
            user=serialize_user(current_user),
            action_type="match_cancelled",
            action_label="Match cancelled",
            details={"match_id": str(match["_id"])},
        )

        return jsonify(
            {
                "success": True,
                "message": "Match cancelled successfully.",
                "match": serialize_match(updated_match, str(current_user["_id"])),
                "data": serialize_match(updated_match, str(current_user["_id"])),
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while cancelling a match")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while cancelling a match")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while cancelling a match")
        return _json_error("Could not cancel the match.", 500)
