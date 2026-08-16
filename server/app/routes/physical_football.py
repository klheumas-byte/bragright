from flask import Blueprint, current_app, g, jsonify, request

from ..services.admin_access import SUPER_ADMIN_ROLES, get_user_role
from ..services.api_security import api_error, get_json_object
from ..services.physical_football_service import (
    PhysicalFootballError,
    confirm_teams,
    create_session,
    current_session,
    get_session,
    list_sessions,
    save_manual_teams,
    serialize_session,
    set_availability,
    set_player_pool,
    set_session_status,
    shuffle_teams,
)
from ..services.physical_football_live_service import (
    assign_coordinator,
    configure_live_session,
    correct_current_score,
    end_live_session,
    record_goal_event,
    record_winner_stays_result,
    rename_team,
    require_coordinator,
    review_goal_event,
    start_live_session,
    update_head_to_head_score,
    update_winner_stays_queue,
)
from .auth import require_role


physical_football_bp = Blueprint("physical_football", __name__)
ORGANIZER_ROLES = tuple(SUPER_ADMIN_ROLES)


@physical_football_bp.errorhandler(PhysicalFootballError)
def handle_physical_football_error(error):
    return api_error(str(error), error.status_code, error.code)


def organizer_view():
    return get_user_role(g.current_user, current_app.config) in SUPER_ADMIN_ROLES


def session_response(session):
    return jsonify({"success": True, "data": {"session": serialize_session(
        current_app.config, session, str(g.current_user["_id"]), organizer_view()
    )}})


@physical_football_bp.get("/sessions/current")
@require_role("player", *ORGANIZER_ROLES)
def get_current_physical_session():
    return session_response(current_session(current_app.config))


@physical_football_bp.get("/sessions")
@require_role(*ORGANIZER_ROLES)
def get_physical_sessions():
    sessions = [serialize_session(current_app.config, item, str(g.current_user["_id"]), True) for item in list_sessions(current_app.config)]
    return jsonify({"success": True, "data": {"sessions": sessions}})


@physical_football_bp.post("/sessions")
@require_role(*ORGANIZER_ROLES)
def create_physical_session():
    payload, error = get_json_object(
        allowed_fields={"date", "location", "start_time", "end_time", "availability_cutoff"}
    )
    if error:
        return error
    return session_response(create_session(current_app.config, payload, g.current_user["_id"])), 201


@physical_football_bp.patch("/sessions/<session_id>/status")
@require_role(*ORGANIZER_ROLES)
def update_physical_session_status(session_id):
    payload, error = get_json_object(allowed_fields={"status"})
    if error:
        return error
    return session_response(set_session_status(current_app.config, session_id, payload.get("status")))


@physical_football_bp.put("/sessions/<session_id>/availability")
@require_role("player")
def update_physical_availability(session_id):
    payload, error = get_json_object(allowed_fields={"status"})
    if error:
        return error
    session = set_availability(current_app.config, session_id, g.current_user["_id"], payload.get("status"))
    return session_response(session)


@physical_football_bp.put("/sessions/<session_id>/player-pool")
@require_role("player", *ORGANIZER_ROLES)
def update_physical_player_pool(session_id):
    payload, error = get_json_object(allowed_fields={"player_ids"})
    if error:
        return error
    if not isinstance(payload.get("player_ids"), list):
        return api_error("player_ids must be a list.", 422, "invalid_player_pool")
    require_coordinator(current_app.config, get_session(current_app.config, session_id), g.current_user)
    return session_response(set_player_pool(current_app.config, session_id, payload["player_ids"]))


@physical_football_bp.post("/sessions/<session_id>/teams/shuffle")
@require_role("player", *ORGANIZER_ROLES)
def shuffle_physical_teams(session_id):
    payload, error = get_json_object(allowed_fields={"team_count"})
    if error:
        return error
    require_coordinator(current_app.config, get_session(current_app.config, session_id), g.current_user)
    return session_response(shuffle_teams(current_app.config, session_id, payload.get("team_count")))


@physical_football_bp.put("/sessions/<session_id>/teams")
@require_role("player", *ORGANIZER_ROLES)
def update_physical_teams(session_id):
    payload, error = get_json_object(allowed_fields={"teams"})
    if error:
        return error
    require_coordinator(current_app.config, get_session(current_app.config, session_id), g.current_user)
    return session_response(save_manual_teams(current_app.config, session_id, payload.get("teams")))


@physical_football_bp.post("/sessions/<session_id>/teams/confirm")
@require_role("player", *ORGANIZER_ROLES)
def confirm_physical_teams(session_id):
    require_coordinator(current_app.config, get_session(current_app.config, session_id), g.current_user)
    return session_response(confirm_teams(current_app.config, session_id))


@physical_football_bp.patch("/sessions/<session_id>/coordinator")
@require_role(*ORGANIZER_ROLES)
def update_physical_coordinator(session_id):
    payload, error = get_json_object(allowed_fields={"player_id"})
    if error:
        return error
    return session_response(assign_coordinator(current_app.config, session_id, payload.get("player_id")))


@physical_football_bp.patch("/sessions/<session_id>/teams/<team_id>")
@require_role("player", *ORGANIZER_ROLES)
def rename_physical_team(session_id, team_id):
    payload, error = get_json_object(allowed_fields={"name"})
    if error:
        return error
    return session_response(rename_team(current_app.config, session_id, team_id, payload.get("name"), g.current_user))


@physical_football_bp.put("/sessions/<session_id>/live/config")
@require_role("player", *ORGANIZER_ROLES)
def configure_physical_live_session(session_id):
    payload, error = get_json_object(allowed_fields={"format", "match_duration_minutes", "session_duration_minutes"})
    if error:
        return error
    return session_response(configure_live_session(current_app.config, session_id, payload, g.current_user))


@physical_football_bp.post("/sessions/<session_id>/live/start")
@require_role("player", *ORGANIZER_ROLES)
def start_physical_live_session(session_id):
    return session_response(start_live_session(current_app.config, session_id, g.current_user))


@physical_football_bp.post("/sessions/<session_id>/live/matches/<match_id>/result")
@require_role("player", *ORGANIZER_ROLES)
def record_physical_winner_stays_result(session_id, match_id):
    payload, error = get_json_object(allowed_fields={"team_one_score", "team_two_score"})
    if error:
        return error
    return session_response(record_winner_stays_result(current_app.config, session_id, match_id, payload, g.current_user))


@physical_football_bp.post("/sessions/<session_id>/live/goals")
@require_role("player", *ORGANIZER_ROLES)
def create_physical_goal_event(session_id):
    payload, error = get_json_object(allowed_fields={"scorer_id", "assist_id", "direct"})
    if error:
        return error
    return session_response(record_goal_event(current_app.config, session_id, payload, g.current_user)), 201


@physical_football_bp.patch("/sessions/<session_id>/live/goals/<event_id>")
@require_role("player", *ORGANIZER_ROLES)
def review_physical_goal_event(session_id, event_id):
    payload, error = get_json_object(allowed_fields={"action", "scorer_id", "assist_id", "elapsed_seconds"})
    if error:
        return error
    return session_response(review_goal_event(current_app.config, session_id, event_id, payload, g.current_user))


@physical_football_bp.put("/sessions/<session_id>/live/score-correction")
@require_role("player", *ORGANIZER_ROLES)
def correct_physical_live_score(session_id):
    payload, error = get_json_object(allowed_fields={"team_one_score", "team_two_score"})
    if error:
        return error
    return session_response(correct_current_score(current_app.config, session_id, payload, g.current_user))


@physical_football_bp.put("/sessions/<session_id>/live/head-to-head/score")
@require_role("player", *ORGANIZER_ROLES)
def update_physical_head_to_head_score(session_id):
    payload, error = get_json_object(allowed_fields={"team_one_score", "team_two_score"})
    if error:
        return error
    return session_response(update_head_to_head_score(current_app.config, session_id, payload, g.current_user))


@physical_football_bp.put("/sessions/<session_id>/live/queue")
@require_role("player", *ORGANIZER_ROLES)
def update_physical_winner_stays_queue(session_id):
    payload, error = get_json_object(allowed_fields={"team_ids"})
    if error:
        return error
    if not isinstance(payload.get("team_ids"), list):
        return api_error("team_ids must be a list.", 422, "invalid_waiting_queue")
    return session_response(update_winner_stays_queue(
        current_app.config, session_id, payload["team_ids"], g.current_user
    ))


@physical_football_bp.post("/sessions/<session_id>/live/end")
@require_role("player", *ORGANIZER_ROLES)
def end_physical_live_session(session_id):
    return session_response(end_live_session(current_app.config, session_id, g.current_user))
