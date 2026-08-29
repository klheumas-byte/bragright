from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING


MATCH_STATUS_MATCH_REQUESTED = "match_requested"
MATCH_STATUS_SCHEDULED = "scheduled"
MATCH_STATUS_PENDING_RESULT = "pending_result"
MATCH_STATUS_PENDING_CONFIRMATION = "pending_confirmation"
MATCH_STATUS_CONFIRMED = "confirmed"
MATCH_STATUS_DISPUTED = "disputed"
MATCH_STATUS_REJECTED = "rejected"
MATCH_STATUS_CANCELLED = "cancelled"
MATCH_STATUS_EXPIRED = "expired"

MATCH_RESULT_SOURCE_PLAYER = "player"
MATCH_RESULT_SOURCE_ADMIN = "admin"
MATCH_ACTION_ROUTES = {
    "match_request": "/matches/{match_id}/respond",
    "result_required": "/matches/{match_id}/result/submit",
    "result_awaiting_confirmation": "/matches/{match_id}/result/confirm",
    "match_confirmed": "/dashboard/matches?matchId={match_id}",
    "dispute_status": "/dashboard/matches?matchId={match_id}",
    "match_resolved": "/dashboard/matches?matchId={match_id}",
    "match_cancelled": "/dashboard/matches?matchId={match_id}",
}

PLAYER_VISIBLE_MATCH_STATUSES = {
    MATCH_STATUS_MATCH_REQUESTED,
    MATCH_STATUS_SCHEDULED,
    MATCH_STATUS_PENDING_RESULT,
    MATCH_STATUS_PENDING_CONFIRMATION,
    MATCH_STATUS_CONFIRMED,
    MATCH_STATUS_DISPUTED,
    MATCH_STATUS_REJECTED,
    MATCH_STATUS_CANCELLED,
    MATCH_STATUS_EXPIRED,
}

MATCH_STATUS_TRANSITIONS = {
    MATCH_STATUS_MATCH_REQUESTED: {
        MATCH_STATUS_PENDING_RESULT,
        MATCH_STATUS_CANCELLED,
        MATCH_STATUS_EXPIRED,
    },
    MATCH_STATUS_SCHEDULED: {
        MATCH_STATUS_PENDING_RESULT,
        MATCH_STATUS_CANCELLED,
        MATCH_STATUS_EXPIRED,
    },
    MATCH_STATUS_PENDING_RESULT: {
        MATCH_STATUS_PENDING_CONFIRMATION,
        MATCH_STATUS_CANCELLED,
        MATCH_STATUS_EXPIRED,
    },
    MATCH_STATUS_PENDING_CONFIRMATION: {
        MATCH_STATUS_CONFIRMED,
        MATCH_STATUS_DISPUTED,
    },
    MATCH_STATUS_DISPUTED: {
        MATCH_STATUS_CONFIRMED,
        MATCH_STATUS_REJECTED,
    },
}

MATCH_STATUS_GROUPS = {
    "requested": {
        "title": "Match requests",
        "statuses": [MATCH_STATUS_MATCH_REQUESTED, MATCH_STATUS_SCHEDULED],
    },
    "waiting_for_result": {
        "title": "Waiting for result",
        "statuses": [MATCH_STATUS_PENDING_RESULT],
    },
    "awaiting_confirmation": {
        "title": "Awaiting confirmation",
        "statuses": [MATCH_STATUS_PENDING_CONFIRMATION],
    },
    "confirmed": {
        "title": "Confirmed",
        "statuses": [MATCH_STATUS_CONFIRMED],
    },
    "disputed": {
        "title": "Disputed",
        "statuses": [MATCH_STATUS_DISPUTED],
    },
    "closed": {
        "title": "Cancelled, rejected, or expired",
        "statuses": [
            MATCH_STATUS_CANCELLED,
            MATCH_STATUS_REJECTED,
            MATCH_STATUS_EXPIRED,
        ],
    },
}


def now_utc():
    return datetime.now(timezone.utc)


def ensure_utc_datetime(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def serialize_datetime(value):
    return value.isoformat() if value else None


def build_match_action_url(action_type, match_id):
    template = MATCH_ACTION_ROUTES.get(
        action_type, "/dashboard/matches?matchId={match_id}"
    )
    return template.format(match_id=match_id)


def normalize_match_status(status):
    normalized = "_".join(str(status or "").strip().lower().replace("-", " ").split())
    if normalized == "pending":
        return MATCH_STATUS_PENDING_CONFIRMATION
    if normalized == "pending_results":
        return MATCH_STATUS_PENDING_RESULT
    if normalized == "pending_confirmation_result":
        return MATCH_STATUS_PENDING_CONFIRMATION
    if normalized == MATCH_STATUS_SCHEDULED:
        return MATCH_STATUS_MATCH_REQUESTED
    if normalized == "canceled":
        return MATCH_STATUS_CANCELLED
    return normalized or MATCH_STATUS_PENDING_RESULT


def format_match_status(status):
    return str(normalize_match_status(status) or "unknown").replace("_", " ").title()


def is_valid_transition(current_status, next_status):
    current_status = normalize_match_status(current_status)
    next_status = normalize_match_status(next_status)
    return next_status in MATCH_STATUS_TRANSITIONS.get(current_status, set())


def build_invalid_transition_error(current_status, next_status):
    return {
        "success": False,
        "message": (
            f"Invalid match status transition from {format_match_status(current_status)} "
            f"to {format_match_status(next_status)}."
        ),
        "error_code": "invalid_match_transition",
        "current_status": normalize_match_status(current_status),
        "requested_status": normalize_match_status(next_status),
    }


def parse_object_id(value):
    raw_value = str(value or "").strip()
    if not raw_value:
        return None, None

    try:
        return raw_value, ObjectId(raw_value)
    except InvalidId:
        return None, None


def resolve_match_players(match_document):
    player_one_id = (
        match_document.get("player_one_id")
        or match_document.get("submitted_by")
        or match_document.get("created_by")
        or ""
    )
    player_two_id = (
        match_document.get("player_two_id")
        or match_document.get("opponent_id")
        or ""
    )

    player_one_name = (
        match_document.get("player_one_name")
        or match_document.get("submitted_by_name")
        or "Unknown player"
    )
    player_two_name = (
        match_document.get("player_two_name")
        or match_document.get("opponent_name")
        or "Unknown opponent"
    )

    return {
        "player_one_id": player_one_id,
        "player_two_id": player_two_id,
        "player_one_name": player_one_name,
        "player_two_name": player_two_name,
    }


def get_match_participant_role(match_document, user_id):
    players = resolve_match_players(match_document)
    if players["player_one_id"] == user_id:
        return "player_one"
    if players["player_two_id"] == user_id:
        return "player_two"
    return "viewer"


def get_match_opponent_id(match_document, user_id):
    players = resolve_match_players(match_document)
    if players["player_one_id"] == user_id:
        return players["player_two_id"]
    if players["player_two_id"] == user_id:
        return players["player_one_id"]
    return ""


def get_match_opponent_name(match_document, user_id):
    players = resolve_match_players(match_document)
    if players["player_one_id"] == user_id:
        return players["player_two_name"]
    if players["player_two_id"] == user_id:
        return players["player_one_name"]
    return "Unknown opponent"


def get_match_requested_to(match_document):
    return (
        match_document.get("requested_to")
        or match_document.get("player_two_id")
        or match_document.get("opponent_id")
        or ""
    )


def is_legacy_pending_request(match_document):
    status = normalize_match_status(match_document.get("status"))
    if status != MATCH_STATUS_PENDING_RESULT:
        return False

    # Older request records were created directly as pending_result.
    return (
        not match_document.get("accepted_at")
        and not match_document.get("result_submitted_at")
        and not match_document.get("player_one_score")
        and not match_document.get("player_two_score")
        and bool(get_match_requested_to(match_document))
    )


def resolve_actionable_status(match_document):
    status = normalize_match_status(match_document.get("status"))
    if status in {MATCH_STATUS_MATCH_REQUESTED, MATCH_STATUS_SCHEDULED}:
        return MATCH_STATUS_MATCH_REQUESTED
    if is_legacy_pending_request(match_document):
        return MATCH_STATUS_MATCH_REQUESTED
    return status


def calculate_winner_id(player_one_id, player_two_id, player_one_score, player_two_score):
    if player_one_score > player_two_score:
        return player_one_id
    if player_two_score > player_one_score:
        return player_two_id
    return None


def _parse_whole_score(value):
    if isinstance(value, bool):
        raise ValueError
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not value.is_integer():
            raise ValueError
        return int(value)

    normalized_value = str(value or "").strip()
    if not normalized_value or not normalized_value.lstrip("-").isdigit():
        raise ValueError
    return int(normalized_value)


def validate_scores_and_winner(match_document, player_one_score, player_two_score, winner_id):
    try:
        player_one_score = _parse_whole_score(player_one_score)
        player_two_score = _parse_whole_score(player_two_score)
    except (TypeError, ValueError):
        return None, "Scores must be whole numbers."

    if player_one_score < 0 or player_two_score < 0:
        return None, "Scores cannot be negative."

    players = resolve_match_players(match_document)
    derived_winner_id = calculate_winner_id(
        players["player_one_id"],
        players["player_two_id"],
        player_one_score,
        player_two_score,
    )

    normalized_winner_id = str(winner_id or "").strip() or None

    if normalized_winner_id and normalized_winner_id not in {
        players["player_one_id"],
        players["player_two_id"],
    }:
        return None, "Winner must be one of the players in the match."

    if derived_winner_id is None and normalized_winner_id is not None:
        return None, "Winner cannot be set when the score is a draw."

    if derived_winner_id is not None and normalized_winner_id not in {None, derived_winner_id}:
        return None, "Winner must match the score outcome."

    return {
        "player_one_score": player_one_score,
        "player_two_score": player_two_score,
        "winner_id": derived_winner_id,
    }, None


def serialize_match(
    match_document,
    current_user_id=None,
    *,
    include_actions=True,
    player_profiles=None,
):
    players = resolve_match_players(match_document)
    player_profiles = player_profiles or {}
    player_one_profile = player_profiles.get(players["player_one_id"], {})
    player_two_profile = player_profiles.get(players["player_two_id"], {})
    participant_role = get_match_participant_role(match_document, current_user_id or "")
    user_is_player = participant_role in {"player_one", "player_two"}
    opponent_id = get_match_opponent_id(match_document, current_user_id or "")
    opponent_name = get_match_opponent_name(match_document, current_user_id or "")
    player_is_one = participant_role == "player_one"

    raw_player_one_score = match_document.get("player_one_score")
    raw_player_two_score = match_document.get("player_two_score")
    current_user_score = raw_player_one_score if player_is_one else raw_player_two_score
    opponent_score = raw_player_two_score if player_is_one else raw_player_one_score

    status = resolve_actionable_status(match_document)
    winner_id = match_document.get("winner_id")
    confirmed_status = status == MATCH_STATUS_CONFIRMED

    if confirmed_status and winner_id == current_user_id:
        result = "win"
        result_label = "W"
    elif confirmed_status and winner_id and current_user_id and winner_id != current_user_id:
        result = "loss"
        result_label = "L"
    elif confirmed_status and current_user_score is not None and opponent_score is not None and current_user_score == opponent_score:
        result = "draw"
        result_label = "D"
    else:
        result = "pending"
        result_label = "-"

    can_submit_result = (
        include_actions
        and user_is_player
        and status == MATCH_STATUS_PENDING_RESULT
    )
    can_accept = (
        include_actions
        and user_is_player
        and status == MATCH_STATUS_MATCH_REQUESTED
        and get_match_requested_to(match_document) == current_user_id
    )
    can_decline = can_accept
    can_confirm = (
        include_actions
        and user_is_player
        and status == MATCH_STATUS_PENDING_CONFIRMATION
        and match_document.get("result_submitted_by") != current_user_id
    )
    can_dispute = can_confirm
    can_cancel = (
        include_actions
        and user_is_player
        and status in {MATCH_STATUS_MATCH_REQUESTED, MATCH_STATUS_SCHEDULED, MATCH_STATUS_PENDING_RESULT}
    )
    can_forfeit = include_actions and user_is_player and status == MATCH_STATUS_PENDING_RESULT and bool(match_document.get("accepted_at"))
    restart_requested_by = match_document.get("restart_requested_by")
    restart_available = (
        include_actions
        and user_is_player
        and status == MATCH_STATUS_PENDING_RESULT
        and match_document.get("result_type") != "forfeit"
    )
    can_request_restart = restart_available and not restart_requested_by
    can_respond_restart = (
        restart_available
        and bool(restart_requested_by)
        and restart_requested_by != current_user_id
    )

    return {
        "id": str(match_document["_id"]),
        "player_one_id": players["player_one_id"],
        "player_two_id": players["player_two_id"],
        "player_one_name": players["player_one_name"],
        "player_two_name": players["player_two_name"],
        "player_one": {
            "id": players["player_one_id"],
            "username": players["player_one_name"],
            "profile_image": player_one_profile.get("profile_image") or "",
        },
        "player_two": {
            "id": players["player_two_id"],
            "username": players["player_two_name"],
            "profile_image": player_two_profile.get("profile_image") or "",
        },
        "created_by": match_document.get("created_by") or players["player_one_id"],
        "requested_to": get_match_requested_to(match_document) or players["player_two_id"],
        "result_submitted_by": match_document.get("result_submitted_by"),
        "confirmed_by": match_document.get("confirmed_by"),
        "disputed_by": match_document.get("disputed_by"),
        "reviewed_by": match_document.get("reviewed_by"),
        "accepted_by": match_document.get("accepted_by"),
        "declined_by": match_document.get("declined_by"),
        "cancelled_by": match_document.get("cancelled_by"),
        "status": status,
        "previous_status": normalize_match_status(match_document.get("previous_status")) if match_document.get("previous_status") else None,
        "display_status": format_match_status(status),
        "player_one_score": raw_player_one_score,
        "player_two_score": raw_player_two_score,
        "winner_id": winner_id,
        "result_type": match_document.get("result_type") or "normal",
        "restart_requested_by": restart_requested_by,
        "restart_requested_at": serialize_datetime(match_document.get("restart_requested_at")),
        "restart_reason": match_document.get("restart_reason") or "",
        "restart_of": match_document.get("restart_of"),
        "superseded_by": match_document.get("superseded_by"),
        "restart_requested_by_current_user": bool(
            restart_requested_by and restart_requested_by == current_user_id
        ),
        "quit_by": match_document.get("quit_by"),
        "quit_reason": match_document.get("quit_reason"),
        "ranking_points": match_document.get("ranking_points") or {},
        "result_history": match_document.get("result_history") or [],
        "result_source": match_document.get("result_source") or MATCH_RESULT_SOURCE_PLAYER,
        "proof_image_url": match_document.get("proof_image_url"),
        "dispute_note": match_document.get("dispute_note"),
        "resolution_note": match_document.get("resolution_note"),
        "resolution_action": match_document.get("resolution_action"),
        "game": match_document.get("game") or "",
        "match_type": match_document.get("match_type") or "Competitive Match",
        "request_message": match_document.get("request_message") or "",
        "decline_reason": match_document.get("decline_reason"),
        "decline_note": match_document.get("decline_note") or "",
        "rejection_reason": match_document.get("rejection_reason"),
        "rejection_explanation": match_document.get("rejection_explanation") or "",
        "rejection_proof_image_url": match_document.get("rejection_proof_image_url"),
        "proposed_player_one_score": match_document.get("proposed_player_one_score"),
        "proposed_player_two_score": match_document.get("proposed_player_two_score"),
        "created_at": serialize_datetime(match_document.get("created_at")),
        "accepted_at": serialize_datetime(match_document.get("accepted_at")),
        "scheduled_at": serialize_datetime(match_document.get("scheduled_at")),
        "request_expires_at": serialize_datetime(match_document.get("request_expires_at")),
        "played_at": serialize_datetime(match_document.get("played_at")),
        "declined_at": serialize_datetime(match_document.get("declined_at")),
        "result_submitted_at": serialize_datetime(match_document.get("result_submitted_at")),
        "confirmed_at": serialize_datetime(match_document.get("confirmed_at")),
        "disputed_at": serialize_datetime(match_document.get("disputed_at")),
        "reviewed_at": serialize_datetime(match_document.get("reviewed_at")),
        "cancelled_at": serialize_datetime(match_document.get("cancelled_at")),
        "abandoned_at": serialize_datetime(match_document.get("abandoned_at")),
        "expired_at": serialize_datetime(match_document.get("expired_at")),
        "updated_at": serialize_datetime(match_document.get("updated_at")),
        "opponent": {
            "id": opponent_id,
            "username": opponent_name,
            "profile_image": (
                player_two_profile.get("profile_image")
                if player_is_one
                else player_one_profile.get("profile_image")
            )
            or "",
        },
        "current_user_role": participant_role,
        "current_user_score": current_user_score,
        "can_forfeit": can_forfeit,
        "can_request_restart": can_request_restart,
        "can_respond_restart": can_respond_restart,
        "opponent_score": opponent_score,
        "score_line": build_score_line(current_user_score, opponent_score),
        "result": result,
        "result_label": result_label,
        "can_accept": can_accept,
        "can_decline": can_decline,
        "can_submit_result": can_submit_result,
        "can_confirm": can_confirm,
        "can_dispute": can_dispute,
        "can_cancel": can_cancel,
        "status_message": build_actor_status_message(match_document, status),
    }


def build_actor_status_message(match_document, status=None):
    players = resolve_match_players(match_document)
    status = status or resolve_actionable_status(match_document)
    names = {
        players["player_one_id"]: players["player_one_name"],
        players["player_two_id"]: players["player_two_name"],
    }
    actor_name = lambda field, fallback="A player": names.get(match_document.get(field), fallback)
    if status == MATCH_STATUS_MATCH_REQUESTED:
        return f"Awaiting {names.get(get_match_requested_to(match_document), 'opponent')}'s response"
    if status == MATCH_STATUS_PENDING_RESULT:
        return f"Accepted by {actor_name('accepted_by')}"
    if status == MATCH_STATUS_PENDING_CONFIRMATION:
        confirmer_id = (
            players["player_two_id"]
            if match_document.get("result_submitted_by") == players["player_one_id"]
            else players["player_one_id"]
        )
        return f"Awaiting {names.get(confirmer_id, 'opponent')}'s confirmation"
    if status == MATCH_STATUS_CONFIRMED:
        return f"Result confirmed by {actor_name('confirmed_by', 'an authorized reviewer')}"
    if status == MATCH_STATUS_DISPUTED:
        return f"Result rejected by {actor_name('disputed_by')}"
    if status == MATCH_STATUS_CANCELLED:
        if match_document.get("declined_by"):
            return f"{actor_name('declined_by')} declined the match request"
        return f"Match cancelled by {actor_name('cancelled_by')}"
    if status == MATCH_STATUS_EXPIRED:
        return "Automatically cancelled after expiry"
    return format_match_status(status)


def build_score_line(player_score, opponent_score):
    if player_score is None and opponent_score is None:
        return "No result submitted"
    return f"{player_score if player_score is not None else '-'} - {opponent_score if opponent_score is not None else '-'}"


def get_matches_for_user(user_id, matches_collection, *, limit=None, skip=0):
    cursor = matches_collection.find(
        {
            "$or": [
                {"player_one_id": user_id},
                {"player_two_id": user_id},
                {"submitted_by": user_id},
                {"opponent_id": user_id},
            ]
        }
    ).sort("updated_at", DESCENDING)

    if limit:
        cursor = cursor.limit(limit)
    if skip:
        cursor = cursor.skip(skip)

    return list(cursor)


def group_matches_by_status(serialized_matches):
    grouped = {
        "matches": serialized_matches,
        "requested": [],
        "waiting_for_result": [],
        "awaiting_confirmation": [],
        "confirmed": [],
        "disputed": [],
        "closed": [],
    }

    for match in serialized_matches:
        status = resolve_actionable_status(match)
        if status == MATCH_STATUS_MATCH_REQUESTED:
            grouped["requested"].append(match)
        elif status == MATCH_STATUS_PENDING_RESULT:
            grouped["waiting_for_result"].append(match)
        elif status == MATCH_STATUS_PENDING_CONFIRMATION:
            grouped["awaiting_confirmation"].append(match)
        elif status == MATCH_STATUS_CONFIRMED:
            grouped["confirmed"].append(match)
        elif status == MATCH_STATUS_DISPUTED:
            grouped["disputed"].append(match)
        elif status in {MATCH_STATUS_CANCELLED, MATCH_STATUS_REJECTED, MATCH_STATUS_EXPIRED}:
            grouped["closed"].append(match)

    return grouped


def create_match_action_items(current_user, matches_collection, *, is_admin=False, related_matches=None):
    current_user_id = str(current_user.get("id") or "")
    items = []

    if is_admin:
        disputed_matches = list(
            matches_collection.find({"status": MATCH_STATUS_DISPUTED}).sort("updated_at", DESCENDING)
        )
        for match in disputed_matches:
            players = resolve_match_players(match)
            items.append(
                {
                    "id": f"admin-dispute-{match['_id']}",
                    "type": "dispute_requiring_review",
                    "title": "Dispute requires admin review",
                    "message": (
                        f"{players['player_one_name']} vs {players['player_two_name']} needs a final review."
                    ),
                    "related_match_id": str(match["_id"]),
                    "action_url": "/admin/disputes",
                    "created_at": serialize_datetime(match.get("disputed_at") or match.get("updated_at") or match.get("created_at")),
                }
            )

        return build_action_payload(items)

    related_matches = related_matches if related_matches is not None else get_matches_for_user(current_user_id, matches_collection)
    for match in related_matches:
        players = resolve_match_players(match)
        status = resolve_actionable_status(match)
        match_id = str(match["_id"])

        if status == MATCH_STATUS_MATCH_REQUESTED and get_match_requested_to(match) == current_user_id:
            items.append(
                {
                    "id": f"match-request-{match_id}",
                    "type": "match_request",
                    "title": "New match request",
                    "message": f"Match request from {players['player_one_name']}",
                    "related_match_id": match_id,
                    "action_url": build_match_action_url("match_request", match_id),
                    "created_at": serialize_datetime(match.get("created_at")),
                }
            )

        if status == MATCH_STATUS_PENDING_CONFIRMATION and match.get("result_submitted_by") != current_user_id:
            submitter_name = (
                players["player_one_name"]
                if match.get("result_submitted_by") == players["player_one_id"]
                else players["player_two_name"]
            )
            items.append(
                {
                    "id": f"pending-confirmation-{match_id}",
                    "type": "result_awaiting_confirmation",
                    "title": "Result awaiting your confirmation",
                    "message": f"{submitter_name} submitted a result that needs your confirmation.",
                    "related_match_id": match_id,
                    "action_url": build_match_action_url("result_awaiting_confirmation", match_id),
                    "created_at": serialize_datetime(match.get("result_submitted_at") or match.get("updated_at")),
                }
            )

        if (
            status == MATCH_STATUS_PENDING_RESULT
            and match.get("accepted_at")
            and current_user_id in {players["player_one_id"], players["player_two_id"]}
        ):
            items.append(
                {
                    "id": f"result-required-{match_id}",
                    "type": "result_required",
                    "title": "Match result required",
                    "message": f"Enter the result for {players['player_one_name']} vs {players['player_two_name']}.",
                    "related_match_id": match_id,
                    "action_url": build_match_action_url("result_required", match_id),
                    "created_at": serialize_datetime(match.get("accepted_at") or match.get("updated_at")),
                }
            )

        if status == MATCH_STATUS_DISPUTED and current_user_id in {players["player_one_id"], players["player_two_id"]}:
            items.append(
                {
                    "id": f"player-dispute-{match_id}",
                    "type": "dispute_status",
                    "title": "Match disputed",
                    "message": f"{players['player_one_name']} vs {players['player_two_name']} is waiting for admin review.",
                    "related_match_id": match_id,
                    "action_url": build_match_action_url("dispute_status", match_id),
                    "created_at": serialize_datetime(match.get("disputed_at") or match.get("updated_at")),
                }
            )

        if status in {
            MATCH_STATUS_CONFIRMED,
            MATCH_STATUS_REJECTED,
            MATCH_STATUS_CANCELLED,
        } and match.get("updated_at"):
            if status == MATCH_STATUS_CONFIRMED:
                items.append(
                    {
                        "id": f"match-confirmed-{match_id}",
                        "type": "match_confirmed",
                        "title": "Match result confirmed",
                        "message": build_actor_status_message(match, status),
                        "related_match_id": match_id,
                        "action_url": build_match_action_url("match_confirmed", match_id),
                        "created_at": serialize_datetime(
                            match.get("confirmed_at") or match.get("reviewed_at") or match.get("updated_at")
                        ),
                    }
                )
            if status == MATCH_STATUS_CONFIRMED and match.get("reviewed_by") and match.get("result_submitted_by") == current_user_id:
                items.append(
                    {
                        "id": f"match-resolved-{match_id}",
                        "type": "match_resolved",
                        "title": "Match resolved",
                        "message": "An admin resolved one of your disputed matches.",
                        "related_match_id": match_id,
                        "action_url": build_match_action_url("match_resolved", match_id),
                        "created_at": serialize_datetime(match.get("reviewed_at") or match.get("updated_at")),
                    }
                )
            elif status == MATCH_STATUS_CANCELLED:
                items.append(
                    {
                        "id": f"match-cancelled-{match_id}",
                        "type": "match_cancelled",
                        "title": "Match cancelled",
                        "message": build_actor_status_message(match, status),
                        "related_match_id": match_id,
                        "action_url": build_match_action_url("match_cancelled", match_id),
                        "created_at": serialize_datetime(match.get("cancelled_at") or match.get("updated_at")),
                    }
                )

    return build_action_payload(items)


def build_action_payload(items):
    deduplicated_items = []
    seen_keys = set()

    for item in items:
        dedupe_key = (
            item.get("id"),
            item.get("type"),
            item.get("related_match_id"),
            item.get("action_url"),
        )
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        deduplicated_items.append(item)

    sorted_items = sorted(deduplicated_items, key=lambda item: item.get("created_at") or "", reverse=True)
    match_requests_count = sum(1 for item in sorted_items if item["type"] == "match_request")
    pending_confirmations_count = sum(1 for item in sorted_items if item["type"] == "result_awaiting_confirmation")
    result_required_count = sum(1 for item in sorted_items if item["type"] == "result_required")
    disputed_matches_count = sum(
        1 for item in sorted_items if item["type"] in {"dispute_requiring_review", "dispute_status"}
    )

    return {
        "match_requests_count": match_requests_count,
        "pending_confirmations_count": pending_confirmations_count,
        "disputed_matches_count": disputed_matches_count,
        "result_required_count": result_required_count,
        "total_actions_count": match_requests_count + result_required_count + pending_confirmations_count + disputed_matches_count,
        "items": sorted_items,
    }
