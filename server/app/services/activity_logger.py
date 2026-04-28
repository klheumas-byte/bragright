from datetime import datetime, timedelta, timezone

from flask import current_app, request
from pymongo import DESCENDING
from pymongo.errors import PyMongoError

from ..db import get_activity_logs_collection


def serialize_activity_log(activity_document):
    created_at = activity_document.get("created_at")
    details = activity_document.get("details") or {}
    return {
        "id": str(activity_document["_id"]),
        "user_id": activity_document.get("user_id"),
        "username": activity_document.get("username"),
        "role": activity_document.get("role"),
        "action_type": activity_document.get("action_type"),
        "action_label": activity_document.get("action_label"),
        "details": details,
        "summary": summarize_activity_log(
            activity_document.get("action_type"),
            activity_document.get("action_label"),
            details,
        ),
        "device_info": activity_document.get("device_info"),
        "ip_address": activity_document.get("ip_address"),
        "created_at": created_at.isoformat() if created_at else None,
    }


def record_activity(*, user, action_type, action_label, details=None):
    if not user or not user.get("id"):
        return

    try:
        activity_logs = get_activity_logs_collection(config=current_app.config, logger=current_app.logger)
        activity_logs.insert_one(
            {
                "user_id": user.get("id"),
                "username": user.get("username") or user.get("email") or "Unknown user",
                "role": user.get("role") or ("admin" if user.get("is_admin") else "player"),
                "action_type": action_type,
                "action_label": action_label,
                "details": details or {},
                "device_info": request.headers.get("User-Agent", ""),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr or ""),
                "created_at": datetime.now(timezone.utc),
            }
        )
    except (RuntimeError, PyMongoError):
        current_app.logger.exception("Could not record activity log for action_type=%s", action_type)


def get_activity_logs(*, filters=None, action_types=None, user_id=None, limit=100):
    filters = filters or {}
    query = {}

    if user_id:
        query["user_id"] = user_id

    filter_user = str(filters.get("user", "")).strip()
    if filter_user:
        query["user_id"] = filter_user

    filter_role = str(filters.get("role", "")).strip().lower()
    if filter_role:
        query["role"] = filter_role

    filter_action_type = str(filters.get("action_type", "")).strip().lower()
    if filter_action_type:
        query["action_type"] = filter_action_type

    if action_types:
        query["action_type"] = {"$in": list(action_types)}

    created_at_query = _build_date_range_query(
        start_date=filters.get("start_date"),
        end_date=filters.get("end_date"),
    )
    if created_at_query:
        query["created_at"] = created_at_query

    activity_logs = get_activity_logs_collection(config=current_app.config, logger=current_app.logger)
    documents = list(activity_logs.find(query).sort("created_at", DESCENDING).limit(limit))
    return [serialize_activity_log(document) for document in documents]


def _build_date_range_query(*, start_date=None, end_date=None):
    date_query = {}

    start_datetime = _parse_date_value(start_date, end_of_day=False)
    if start_datetime:
        date_query["$gte"] = start_datetime

    end_datetime = _parse_date_value(end_date, end_of_day=True)
    if end_datetime:
        date_query["$lte"] = end_datetime

    return date_query


def _parse_date_value(value, *, end_of_day):
    raw_value = str(value or "").strip()
    if not raw_value:
        return None

    try:
        parsed = datetime.fromisoformat(raw_value)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    if end_of_day:
        parsed = parsed + timedelta(days=1) - timedelta(microseconds=1)

    return parsed.astimezone(timezone.utc)


def summarize_activity_log(action_type, action_label, details):
    details = details or {}

    if action_type == "login":
        return "Signed in to BragRight."

    if action_type == "match_submitted":
        return (
            "Submitted a match result"
            f" ({details.get('player_score', '-')}-{details.get('opponent_score', '-')})."
        )

    if action_type == "match_scheduled":
        return "Scheduled a new match."

    if action_type == "match_request_accepted":
        return "Accepted a match request."

    if action_type == "match_request_declined":
        return "Declined a match request."

    if action_type == "result_submitted":
        return (
            "Submitted a match result"
            f" ({details.get('player_one_score', '-')}-{details.get('player_two_score', '-')})."
        )

    if action_type == "match_confirmed":
        return "Confirmed a submitted match result."

    if action_type == "match_disputed":
        return "Disputed a submitted match result."

    if action_type == "match_cancelled":
        return "Cancelled a match before final result confirmation."

    if action_type == "match_expired":
        return "Marked a match as expired."

    if action_type == "proof_uploaded":
        return "Uploaded proof for a match."

    if action_type == "profile_updated":
        if details.get("next_username"):
            return f"Updated profile details and changed username to {details.get('next_username')}."

        if details.get("profile_image"):
            return "Updated the profile image."

        return "Updated profile details."

    if action_type == "admin_role_changed":
        return f"Changed a user's role to {details.get('new_role', 'updated role')}."

    if action_type == "admin_status_changed":
        return f"Changed a user's status to {details.get('new_status', 'updated status')}."

    if action_type == "admin_password_reset":
        return "Reset a user's password."

    if action_type == "admin_user_created":
        return f"Created a new {details.get('target_role', 'user')} account."

    if action_type == "admin_dispute_resolved":
        return f"Resolved a disputed match with action {details.get('resolution_action', 'reviewed')}."

    if action_type == "admin_match_resolved":
        return "Admin confirmed a disputed match result."

    if action_type == "admin_match_rejected":
        return "Admin rejected a disputed match result."

    if action_type == "admin_match_overridden":
        return "Admin overrode a disputed match result."

    return action_label or "Recorded account activity."
