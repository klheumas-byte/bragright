from datetime import datetime, timedelta, timezone

from flask import current_app, request
from pymongo import DESCENDING
from pymongo.errors import PyMongoError

from bson import ObjectId
from bson.errors import InvalidId

from ..db import (
    get_activity_logs_collection,
    get_matches_collection,
    get_users_collection,
)


ONE_TIME_MATCH_ACTIONS = {
    "match_scheduled",
    "match_request_accepted",
    "match_request_declined",
    "result_submitted",
    "match_confirmed",
    "match_disputed",
    "match_cancelled",
    "admin_match_resolved",
    "admin_match_rejected",
    "admin_match_overridden",
}
SAFE_DETAIL_FIELDS = {
    "player_one_score",
    "player_two_score",
    "previous_role",
    "new_role",
    "previous_status",
    "new_status",
    "target_role",
    "profile_image_updated",
    "next_username",
    "resolution_action",
}


def serialize_activity_log(
    activity_document,
    *,
    actors_by_id=None,
    matches_by_id=None,
    users_by_id=None,
):
    created_at = activity_document.get("created_at")
    details = activity_document.get("details") or {}
    actors_by_id = actors_by_id or {}
    matches_by_id = matches_by_id or {}
    users_by_id = users_by_id or {}
    actor_id = str(activity_document.get("user_id") or "")
    actor_document = actors_by_id.get(actor_id)
    actor_name = (
        (actor_document or {}).get("username")
        or activity_document.get("username")
        or "Unavailable user"
    )
    safe_details = {
        key: value
        for key, value in details.items()
        if key in SAFE_DETAIL_FIELDS and value not in (None, "")
    }
    target_id = str(details.get("target_user_id") or "")
    target_document = users_by_id.get(target_id)
    if target_id:
        safe_details["target"] = {
            "display_name": (target_document or {}).get("username") or "Unavailable user",
            "available": bool(target_document),
        }

    serialized = {
        "id": str(activity_document["_id"]),
        "role": activity_document.get("role"),
        "action_type": activity_document.get("action_type"),
        "actor": {
            "display_name": actor_name,
            "profile_image": (actor_document or {}).get("profile_image") or "",
            "available": bool(actor_document),
        },
        "details": safe_details,
        "related": _serialize_related_match(details, matches_by_id, users_by_id, actor_id),
        "created_at": created_at.isoformat() if created_at else None,
    }
    return serialized


def record_activity(*, user, action_type, action_label, details=None, event_key=None):
    if not user or not user.get("id"):
        return

    try:
        activity_logs = get_activity_logs_collection(config=current_app.config, logger=current_app.logger)
        details = details or {}
        resolved_event_key = event_key or _derive_event_key(action_type, details)
        document = {
                "user_id": user.get("id"),
                "username": user.get("username") or user.get("email") or "Unknown user",
                "role": user.get("role") or ("admin" if user.get("is_admin") else "player"),
                "action_type": action_type,
                "action_label": action_label,
                "details": details,
                "device_info": request.headers.get("User-Agent", ""),
                "ip_address": request.headers.get("X-Forwarded-For", request.remote_addr or ""),
                "created_at": datetime.now(timezone.utc),
            }
        if resolved_event_key:
            document["event_key"] = resolved_event_key
            activity_logs.update_one(
                {"event_key": resolved_event_key},
                {"$setOnInsert": document},
                upsert=True,
            )
        else:
            activity_logs.insert_one(document)
    except (RuntimeError, PyMongoError):
        current_app.logger.exception("Could not record activity log for action_type=%s", action_type)


def get_activity_logs(
    *,
    filters=None,
    action_types=None,
    user_id=None,
    limit=100,
    page=1,
    return_total=False,
):
    filters = filters or {}
    query = {}

    if user_id:
        query["user_id"] = user_id

    filter_user = str(filters.get("user") or "").strip()
    if filter_user:
        query["user_id"] = filter_user

    filter_role = str(filters.get("role") or "").strip().lower()
    if filter_role:
        query["role"] = filter_role

    filter_action_type = str(filters.get("action_type") or "").strip().lower()
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
    cursor = (
        activity_logs.find(query)
        .sort([("created_at", DESCENDING), ("_id", DESCENDING)])
        .skip((page - 1) * limit)
        .limit(limit)
    )
    documents = list(cursor)
    enrichment = _load_activity_enrichment(documents)
    serialized = [
        serialize_activity_log(
            document,
            **enrichment,
        )
        for document in documents
    ]
    if return_total:
        return serialized, activity_logs.count_documents(query)
    return serialized


def _derive_event_key(action_type, details):
    if action_type not in ONE_TIME_MATCH_ACTIONS:
        return None
    match_id = str((details or {}).get("match_id") or "").strip()
    return f"{action_type}:{match_id}" if match_id else None


def _as_object_ids(values):
    object_ids = []
    for value in values:
        try:
            object_ids.append(ObjectId(str(value)))
        except (InvalidId, TypeError):
            continue
    return object_ids


def _load_activity_enrichment(documents):
    actor_ids = {str(document.get("user_id") or "") for document in documents}
    match_ids = {
        str((document.get("details") or {}).get("match_id") or "")
        for document in documents
    }
    target_ids = {
        str((document.get("details") or {}).get("target_user_id") or "")
        for document in documents
    }
    matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
    match_documents = list(
        matches.find(
            {"_id": {"$in": _as_object_ids(match_ids)}},
            {
                "player_one_id": 1,
                "player_two_id": 1,
                "player_one_name": 1,
                "player_two_name": 1,
                "status": 1,
            },
        )
    ) if any(match_ids) else []
    for match in match_documents:
        target_ids.update(
            {str(match.get("player_one_id") or ""), str(match.get("player_two_id") or "")}
        )

    all_user_ids = actor_ids | target_ids
    users = get_users_collection(config=current_app.config, logger=current_app.logger)
    user_documents = list(
        users.find(
            {"_id": {"$in": _as_object_ids(all_user_ids)}},
            {"username": 1, "profile_image": 1},
        )
    ) if any(all_user_ids) else []
    users_by_id = {str(user["_id"]): user for user in user_documents}
    return {
        "actors_by_id": users_by_id,
        "matches_by_id": {str(match["_id"]): match for match in match_documents},
        "users_by_id": users_by_id,
    }


def _serialize_related_match(details, matches_by_id, users_by_id, actor_id):
    match_id = str((details or {}).get("match_id") or "")
    if not match_id:
        return None
    match = matches_by_id.get(match_id)
    if not match:
        return {"kind": "match", "available": False}

    player_one_id = str(match.get("player_one_id") or "")
    player_two_id = str(match.get("player_two_id") or "")
    opponent_id = player_two_id if actor_id == player_one_id else player_one_id
    opponent = users_by_id.get(opponent_id)
    opponent_name = (
        (opponent or {}).get("username")
        or (match.get("player_two_name") if actor_id == player_one_id else match.get("player_one_name"))
        or "Unavailable player"
    )
    return {
        "kind": "match",
        "available": True,
        "status": match.get("status") or "unknown",
        "path": f"/dashboard/matches?matchId={match_id}",
        "opponent": {
            "display_name": opponent_name,
            "profile_image": (opponent or {}).get("profile_image") or "",
            "available": bool(opponent),
        },
    }


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
