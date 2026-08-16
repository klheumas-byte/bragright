from datetime import date, datetime, timezone
from secrets import SystemRandom
from uuid import uuid4

from bson import ObjectId
from pymongo import ASCENDING, DESCENDING
from pymongo.errors import DuplicateKeyError

from ..db import (
    get_physical_football_availability_collection,
    get_physical_football_sessions_collection,
    get_physical_football_teams_collection,
    get_users_collection,
)


SESSION_STATUSES = {
    "draft",
    "registration_open",
    "registration_closed",
    "teams_confirmed",
    "completed",
}
AVAILABILITY_STATUSES = {"available", "not_available"}


class PhysicalFootballError(RuntimeError):
    def __init__(self, message, *, status_code=400, code="physical_football_error"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def utc_now():
    return datetime.now(timezone.utc)


def parse_session_date(value):
    try:
        parsed = date.fromisoformat(str(value or "").strip())
    except ValueError as error:
        raise PhysicalFootballError("Session date must use YYYY-MM-DD.", code="invalid_session_date") from error
    if parsed.weekday() != 6:
        raise PhysicalFootballError("Physical Football sessions must be scheduled on Sunday.", code="session_must_be_sunday")
    return parsed.isoformat()


def parse_start_time(value):
    value = str(value or "").strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, "%H:%M").strftime("%H:%M")
    except ValueError as error:
        raise PhysicalFootballError("Start time must use HH:MM.", code="invalid_start_time") from error


def parse_session_schedule(session_date, start_value, end_value, cutoff_value):
    start_time = parse_start_time(start_value)
    end_time = parse_start_time(end_value)
    if not start_time or not end_time:
        raise PhysicalFootballError("Start time and end time are required.", code="session_times_required")

    start_at = datetime.fromisoformat(f"{session_date}T{start_time}:00").replace(tzinfo=timezone.utc)
    end_at = datetime.fromisoformat(f"{session_date}T{end_time}:00").replace(tzinfo=timezone.utc)
    if end_at <= start_at:
        raise PhysicalFootballError("End time must be after start time.", code="invalid_session_times")

    cutoff = None
    if str(cutoff_value or "").strip():
        try:
            cutoff = datetime.fromisoformat(str(cutoff_value).strip().replace("Z", "+00:00"))
        except ValueError as error:
            raise PhysicalFootballError(
                "Availability cutoff must use a valid date and time.", code="invalid_availability_cutoff"
            ) from error
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
        cutoff = cutoff.astimezone(timezone.utc)
        if cutoff >= start_at:
            raise PhysicalFootballError(
                "Availability cutoff must be before the session starts.", code="invalid_availability_cutoff"
            )
    return start_time, end_time, cutoff


def create_session(config, payload, actor_id):
    session_date = parse_session_date(payload.get("date"))
    location = str(payload.get("location") or "").strip()
    if not location or len(location) > 160:
        raise PhysicalFootballError("Location is required and must be 160 characters or fewer.", code="invalid_location")
    start_time, end_time, availability_cutoff = parse_session_schedule(
        session_date,
        payload.get("start_time"),
        payload.get("end_time"),
        payload.get("availability_cutoff"),
    )
    now = utc_now()
    sessions = get_physical_football_sessions_collection(config=config)
    if sessions.find_one({"module": "physical_football", "session_date": session_date}, {"_id": 1}):
        raise PhysicalFootballError(
            "A Physical Football session already exists for this Sunday.",
            status_code=409,
            code="session_date_exists",
        )
    document = {
        "module": "physical_football",
        "session_date": session_date,
        "location": location,
        "start_time": start_time,
        "end_time": end_time,
        "availability_cutoff": availability_cutoff,
        "status": "draft",
        "created_by": str(actor_id),
        "selected_player_ids": [],
        "draft_teams": [],
        "confirmed_teams": [],
        "shuffle_version": 0,
        "created_at": now,
        "updated_at": now,
    }
    try:
        result = sessions.insert_one(document)
    except DuplicateKeyError as error:
        raise PhysicalFootballError("A Physical Football session already exists for this Sunday.", status_code=409, code="session_date_exists") from error
    document["_id"] = result.inserted_id
    return document


def get_session(config, session_id):
    if not ObjectId.is_valid(str(session_id)):
        raise PhysicalFootballError("Session was not found.", status_code=404, code="not_found")
    session = get_physical_football_sessions_collection(config=config).find_one({"_id": ObjectId(str(session_id)), "module": "physical_football"})
    if not session:
        raise PhysicalFootballError("Session was not found.", status_code=404, code="not_found")
    return session


def current_session(config):
    today = utc_now().date().isoformat()
    sessions = get_physical_football_sessions_collection(config=config)
    session = sessions.find_one(
        {"module": "physical_football", "session_date": {"$gte": today}, "status": {"$ne": "completed"}},
        sort=[("session_date", ASCENDING), ("updated_at", DESCENDING), ("_id", DESCENDING)],
    )
    if session:
        return session
    return sessions.find_one(
        {"module": "physical_football", "status": {"$ne": "completed"}},
        sort=[("session_date", DESCENDING), ("updated_at", DESCENDING), ("_id", DESCENDING)],
    )


def list_sessions(config, limit=20):
    return list(
        get_physical_football_sessions_collection(config=config)
        .find({"module": "physical_football"})
        .sort("session_date", -1)
        .limit(limit)
    )


def set_session_status(config, session_id, target_status):
    session = get_session(config, session_id)
    target_status = str(target_status or "").strip().lower()
    allowed = {
        "draft": {"registration_open"},
        "registration_open": {"registration_closed"},
        "registration_closed": {"registration_open"},
        "teams_confirmed": {"completed"},
        "completed": set(),
    }
    if target_status not in allowed.get(session["status"], set()):
        raise PhysicalFootballError(
            f"Cannot move a session from {session['status']} to {target_status}.",
            status_code=409,
            code="invalid_session_transition",
        )
    now = utc_now()
    update = {"status": target_status, "updated_at": now}
    if target_status == "registration_open":
        update["availability_opened_at"] = now
        update["selected_player_ids"] = []
        update["draft_teams"] = []
        update["team_count"] = 0
    elif target_status == "registration_closed":
        available = get_physical_football_availability_collection(config=config).find(
            {"session_id": str(session["_id"]), "status": "available"}
        )
        update.update({
            "availability_closed_at": now,
            "selected_player_ids": sorted({item["player_id"] for item in available}),
            "draft_teams": [],
            "team_count": 0,
        })
    elif target_status == "completed":
        update["completed_at"] = now
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": session["status"]}, {"$set": update}
    )
    return get_session(config, session_id)


def set_availability(config, session_id, player_id, status):
    session = get_session(config, session_id)
    if session["status"] != "registration_open":
        raise PhysicalFootballError("Availability can only change while availability is open.", status_code=409, code="availability_not_open")
    status = str(status or "").strip().lower()
    if status not in AVAILABILITY_STATUSES:
        raise PhysicalFootballError("Availability must be available or not_available.", code="invalid_availability")
    now = utc_now()
    get_physical_football_availability_collection(config=config).update_one(
        {"session_id": str(session["_id"]), "player_id": str(player_id)},
        {"$set": {"status": status, "updated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return session


def active_players(config):
    return list(
        get_users_collection(config=config).find(
            {"role": "player", "status": "active", "is_active": {"$ne": False}},
            {"username": 1, "email": 1, "profile_image": 1},
        ).sort("username", ASCENDING)
    )


def set_player_pool(config, session_id, player_ids):
    session = get_session(config, session_id)
    if session["status"] != "registration_closed":
        raise PhysicalFootballError("The player pool can only change after availability closes and before teams are confirmed.", status_code=409, code="player_pool_locked")
    normalized = [str(value) for value in (player_ids or [])]
    if len(normalized) != len(set(normalized)) or any(not ObjectId.is_valid(value) for value in normalized):
        raise PhysicalFootballError("The player pool contains invalid or duplicate players.", code="invalid_player_pool")
    count = get_users_collection(config=config).count_documents(
        {"_id": {"$in": [ObjectId(value) for value in normalized]}, "role": "player", "status": "active", "is_active": {"$ne": False}}
    )
    if count != len(normalized):
        raise PhysicalFootballError("Every selected player must be an active BragRight player.", code="invalid_player_pool")
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": "registration_closed"},
        {"$set": {"selected_player_ids": normalized, "draft_teams": [], "updated_at": utc_now()}},
    )
    return get_session(config, session_id)


def _validated_team_count(player_count, team_count):
    try:
        team_count = int(team_count)
    except (TypeError, ValueError) as error:
        raise PhysicalFootballError("Number of teams must be a whole number.", code="invalid_team_count") from error
    if team_count < 2 or team_count > player_count:
        raise PhysicalFootballError("Number of teams must be between 2 and the selected-player count.", code="invalid_team_count")
    return team_count


def shuffle_teams(config, session_id, team_count):
    session = get_session(config, session_id)
    if session["status"] != "registration_closed":
        raise PhysicalFootballError("Teams can only be built after availability closes.", status_code=409, code="team_builder_locked")
    player_ids = list(session.get("selected_player_ids") or [])
    team_count = _validated_team_count(len(player_ids), team_count)
    SystemRandom().shuffle(player_ids)
    teams = [{"id": uuid4().hex, "name": f"Team {index + 1}", "player_ids": []} for index in range(team_count)]
    for index, player_id in enumerate(player_ids):
        teams[index % team_count]["player_ids"].append(player_id)
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": "registration_closed"},
        {"$set": {"draft_teams": teams, "team_count": team_count, "updated_at": utc_now()}, "$inc": {"shuffle_version": 1}},
    )
    return get_session(config, session_id)


def validate_teams(session, teams):
    if not isinstance(teams, list) or len(teams) < 2:
        raise PhysicalFootballError("At least two teams are required.", code="invalid_teams")
    selected = list(session.get("selected_player_ids") or [])
    assigned = []
    normalized = []
    for index, team in enumerate(teams):
        if not isinstance(team, dict):
            raise PhysicalFootballError("Each team must be an object.", code="invalid_teams")
        player_ids = [str(value) for value in (team.get("player_ids") or [])]
        if not player_ids:
            raise PhysicalFootballError("Every team must contain at least one player.", code="invalid_teams")
        assigned.extend(player_ids)
        normalized.append({
            "id": str(team.get("id") or uuid4().hex),
            "name": str(team.get("name") or f"Team {index + 1}").strip()[:60] or f"Team {index + 1}",
            "player_ids": player_ids,
        })
    if len(assigned) != len(set(assigned)) or set(assigned) != set(selected):
        raise PhysicalFootballError("Every selected player must appear exactly once across the teams.", code="invalid_team_distribution")
    return normalized


def save_manual_teams(config, session_id, teams):
    session = get_session(config, session_id)
    if session["status"] != "registration_closed":
        raise PhysicalFootballError("Teams cannot be edited in the current session state.", status_code=409, code="team_builder_locked")
    normalized = validate_teams(session, teams)
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": "registration_closed"},
        {"$set": {"draft_teams": normalized, "team_count": len(normalized), "updated_at": utc_now()}},
    )
    return get_session(config, session_id)


def confirm_teams(config, session_id):
    session = get_session(config, session_id)
    if session["status"] != "registration_closed":
        raise PhysicalFootballError("Teams can only be confirmed after availability closes.", status_code=409, code="team_builder_locked")
    teams = validate_teams(session, session.get("draft_teams"))
    now = utc_now()
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": "registration_closed"},
        {"$set": {"status": "teams_confirmed", "confirmed_teams": teams, "teams_confirmed_at": now, "updated_at": now}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("The session changed before teams could be confirmed.", status_code=409, code="session_changed")
    team_history = get_physical_football_teams_collection(config=config)
    for team in teams:
        team_history.update_one(
            {"team_id": team["id"]},
            {
                "$set": {"current_name": team["name"], "updated_at": now},
                "$setOnInsert": {"team_id": team["id"], "created_at": now},
                "$push": {"sessions": {
                    "session_id": str(session["_id"]),
                    "name": team["name"],
                    "player_ids": list(team["player_ids"]),
                    "confirmed_at": now,
                }},
            },
            upsert=True,
        )
    return get_session(config, session_id)


def serialize_session(config, session, viewer_id, is_organizer=False):
    if not session:
        return None
    session_id = str(session["_id"])
    availability_rows = list(get_physical_football_availability_collection(config=config).find({"session_id": session_id}))
    availability_by_player = {item["player_id"]: item["status"] for item in availability_rows}
    players = active_players(config)
    player_map = {
        str(item["_id"]): {
            "id": str(item["_id"]),
            "name": item.get("username") or item.get("email") or "Player",
            "availability": availability_by_player.get(str(item["_id"]), "not_set"),
        }
        for item in players
    }
    selected_ids = list(session.get("selected_player_ids") or [])
    is_coordinator = str(session.get("coordinator_id") or "") == str(viewer_id)
    can_manage = is_organizer or is_coordinator
    live_state = session.get("live_state") or {}
    active_team_ids = set((live_state.get("current_match") or {}).get("team_ids") or [])
    viewer_in_current_match = any(
        team.get("id") in active_team_ids and str(viewer_id) in {str(value) for value in team.get("player_ids") or []}
        for team in session.get("confirmed_teams") or []
    )
    visible_teams = session.get("confirmed_teams") or []
    if can_manage and session.get("status") == "registration_closed":
        visible_teams = session.get("draft_teams") or []
    teams = [
        {
            "id": team["id"],
            "name": team["name"],
            "players": [player_map.get(player_id, {"id": player_id, "name": "Unknown player", "availability": "unknown"}) for player_id in team.get("player_ids", [])],
            "player_ids": list(team.get("player_ids") or []) if can_manage else None,
        }
        for team in visible_teams
    ]
    payload = {
        "id": session_id,
        "date": session["session_date"],
        "location": session["location"],
        "start_time": session.get("start_time"),
        "end_time": session.get("end_time"),
        "availability_cutoff": session.get("availability_cutoff"),
        "status": session["status"],
        "coordinator_id": session.get("coordinator_id"),
        "coordinator_name": player_map.get(str(session.get("coordinator_id") or ""), {}).get("name"),
        "session_role": "admin" if is_organizer else "match_coordinator" if is_coordinator else "player",
        "viewer_id": str(viewer_id),
        "capabilities": {
            "can_set_availability": not is_organizer and session["status"] == "registration_open",
            "can_manage_teams": can_manage and session["status"] == "registration_closed",
            "can_assign_coordinator": is_organizer and session["status"] != "completed",
            "can_manage_live": can_manage and session["status"] == "teams_confirmed",
            "can_submit_reports": not is_organizer and viewer_in_current_match and live_state.get("status") == "live",
            "can_record_goals": can_manage and live_state.get("status") == "live",
            "can_override": is_organizer,
        },
        "live_state": session.get("live_state"),
        "my_availability": availability_by_player.get(str(viewer_id), "not_set"),
        "available_player_count": sum(1 for value in availability_by_player.values() if value == "available"),
        "selected_player_count": len(selected_ids),
        "team_count": session.get("team_count") or 0,
        "shuffle_version": session.get("shuffle_version") or 0,
        "teams": teams,
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
    }
    if can_manage:
        payload["players"] = list(player_map.values())
        payload["selected_player_ids"] = selected_ids
    return payload
