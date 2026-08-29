"""Mongo-backed, audience-filtered domain events for near-real-time clients."""

from datetime import datetime, timedelta, timezone

from flask import current_app, g, request

from ..db import get_realtime_events_collection
from .admin_access import get_user_role


EVENT_BY_ENDPOINT = {
    "matches.schedule_match": "challenge.created",
    "matches.accept_match": "challenge.accepted",
    "matches.decline_match": "challenge.declined",
    "matches.submit_match_result": "match.result_submitted",
    "matches.confirm_match": "match.result_confirmed",
    "matches.dispute_match": "match.result_disputed",
    "matches.forfeit_match": "match.updated",
    "matches.restart_match": "match.updated",
    "matches.cancel_match": "match.updated",
    "admin.resolve_admin_dispute": "match.resolved",
    "payments.record_payment": "payment.recorded",
    "payments.submit_player_payment": "payment.recorded",
    "payments.verify_paystack_payment": "subscription.activated",
    "payments.paystack_webhook": "subscription.activated",
    "payments.verify_payment": "subscription.activated",
    "payments.grant_exemption": "subscription.activated",
    "payments.override_subscription_access": "subscription.activated",
    "payments.reject_player_payment": "subscription.restricted",
    "payments.reverse_payment": "subscription.restricted",
}
USER_ID_KEYS = {
    "player_one_id", "player_two_id", "submitted_by", "opponent_id",
    "requested_to", "created_by", "player_id", "user_id", "quit_by",
}


def publish_domain_event(event_type, *, user_ids=(), roles=(), resource=None):
    normalized_users = sorted({str(value) for value in user_ids if value})
    normalized_roles = sorted({str(value) for value in roles if value})
    if not normalized_users and not normalized_roles:
        return None
    now = datetime.now(timezone.utc)
    document = {
        "type": event_type,
        "audience_user_ids": normalized_users,
        "audience_roles": normalized_roles,
        "resource": resource or {},
        "created_at": now,
        "expires_at": now + timedelta(days=2),
    }
    result = get_realtime_events_collection(
        config=current_app.config, logger=current_app.logger
    ).insert_one(document)
    return str(result.inserted_id)


def publish_request_event(response):
    """Publish only after a successful authoritative mutation response."""
    endpoint = request.endpoint or ""
    mutating_get = endpoint == "payments.verify_paystack_payment"
    if (
        request.method not in {"POST", "PUT", "PATCH", "DELETE"}
        and not mutating_get
    ) or response.status_code >= 300:
        return
    event_type = EVENT_BY_ENDPOINT.get(endpoint)
    if endpoint.startswith("physical_football."):
        event_type = "physical_football.updated"
    if not event_type:
        return

    payload = response.get_json(silent=True) or {}
    source = payload.get("data") or payload.get("match") or payload
    if endpoint == "payments.override_subscription_access":
        action = (request.get_json(silent=True) or {}).get("action")
        event_type = "subscription.restricted" if action == "restrict" else "subscription.activated"
    elif (
        event_type == "subscription.activated"
        and isinstance(source, dict)
        and source.get("access_activated") is False
    ):
        event_type = "subscription.restricted"
    user_ids = _collect_user_ids(source)
    actor = getattr(g, "current_user", None)
    if actor and actor.get("_id"):
        user_ids.add(str(actor["_id"]))
    roles = set()
    if endpoint.startswith("payments."):
        roles.update({"admin", "super_admin", "payment_officer"})
    elif endpoint.startswith("admin."):
        roles.update({"admin", "super_admin"})
    elif endpoint.startswith("physical_football."):
        roles.update({"player", "admin", "super_admin"})

    resource = {}
    if isinstance(source, dict):
        resource = {
            "id": str(source.get("id") or source.get("match_id") or source.get("session_id") or ""),
            "status": source.get("status"),
        }
    publish_domain_event(event_type, user_ids=user_ids, roles=roles, resource=resource)
    if (
        event_type == "payment.recorded"
        and isinstance(source, dict)
        and source.get("access_activated") is True
    ):
        publish_domain_event(
            "subscription.activated", user_ids=user_ids, roles=roles, resource=resource
        )
    if event_type.startswith(("payment.", "subscription.")):
        publish_domain_event("notification.updated", user_ids=user_ids, roles=roles, resource=resource)
    if event_type.startswith(("challenge.", "match.")):
        notification_type = "notification.created" if event_type == "challenge.created" else "notification.updated"
        publish_domain_event(notification_type, user_ids=user_ids, roles=roles, resource=resource)
        if event_type != "match.updated" and event_type != "challenge.created":
            publish_domain_event("match.updated", user_ids=user_ids, roles=roles, resource=resource)
    if event_type in {"match.result_confirmed", "match.resolved", "match.updated"}:
        publish_domain_event(
            "leaderboard.updated",
            user_ids=user_ids,
            roles={"player", "admin", "super_admin"},
            resource=resource,
        )


def visible_events(user, *, after_id=None, limit=100):
    user_id = str(user["_id"])
    role = get_user_role(user, current_app.config)
    query = {"$or": [{"audience_user_ids": user_id}, {"audience_roles": role}]}
    if after_id is not None:
        query["_id"] = {"$gt": after_id}
    documents = list(
        get_realtime_events_collection(config=current_app.config, logger=current_app.logger)
        .find(query)
        .sort("_id", 1)
        .limit(limit)
    )
    return [
        {
            "id": str(item["_id"]),
            "type": item["type"],
            "resource": item.get("resource") or {},
            "created_at": _serialize_datetime(item.get("created_at")),
        }
        for item in documents
    ]


def latest_event_cursor(user):
    user_id = str(user["_id"])
    role = get_user_role(user, current_app.config)
    document = (
        get_realtime_events_collection(config=current_app.config, logger=current_app.logger)
        .find_one(
            {"$or": [{"audience_user_ids": user_id}, {"audience_roles": role}]},
            sort=[("_id", -1)],
        )
    )
    return str(document["_id"]) if document else None


def _collect_user_ids(value):
    found = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in USER_ID_KEYS and item:
                found.add(str(item))
            elif isinstance(item, (dict, list)):
                found.update(_collect_user_ids(item))
    elif isinstance(value, list):
        for item in value:
            found.update(_collect_user_ids(item))
    return found


def _serialize_datetime(value):
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
