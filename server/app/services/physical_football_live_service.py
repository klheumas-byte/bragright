from datetime import datetime, timezone
from uuid import uuid4

from bson import ObjectId

from ..db import (
    get_physical_football_sessions_collection,
    get_physical_football_teams_collection,
    get_users_collection,
)
from .admin_access import SUPER_ADMIN_ROLES, get_user_role
from .physical_football_service import PhysicalFootballError, get_session


LIVE_FORMATS = {"winner_stays", "head_to_head"}


def utc_now():
    return datetime.now(timezone.utc)


def session_role(config, session, actor):
    if get_user_role(actor, config) in SUPER_ADMIN_ROLES:
        return "admin"
    if str(session.get("coordinator_id") or "") == str(actor.get("_id") or ""):
        return "match_coordinator"
    return "player"


def require_coordinator(config, session, actor):
    if session_role(config, session, actor) not in {"admin", "match_coordinator"}:
        raise PhysicalFootballError(
            "Match Coordinator or admin access is required.",
            status_code=403,
            code="coordinator_required",
        )


def assign_coordinator(config, session_id, player_id):
    session = get_session(config, session_id)
    if session.get("status") == "completed":
        raise PhysicalFootballError("Completed sessions cannot change coordinator.", status_code=409, code="session_locked")
    normalized = str(player_id or "").strip()
    if normalized:
        if not ObjectId.is_valid(normalized):
            raise PhysicalFootballError("Coordinator must be an active player.", code="invalid_coordinator")
        player = get_users_collection(config=config).find_one({
            "_id": ObjectId(normalized), "role": "player", "status": "active", "is_active": {"$ne": False}
        })
        if not player:
            raise PhysicalFootballError("Coordinator must be an active player.", code="invalid_coordinator")
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": {"$ne": "completed"}},
        {"$set": {"coordinator_id": normalized or None, "updated_at": utc_now()}},
    )
    return get_session(config, session_id)


def rename_team(config, session_id, team_id, name, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    if session.get("status") not in {"registration_closed", "teams_confirmed"}:
        raise PhysicalFootballError("Teams cannot be renamed in the current session state.", status_code=409, code="teams_locked")
    name = str(name or "").strip()
    if not name or len(name) > 60:
        raise PhysicalFootballError("Team name must be 1 to 60 characters.", code="invalid_team_name")
    found = False
    updates = {}
    for field in ("draft_teams", "confirmed_teams"):
        teams = []
        for team in session.get(field) or []:
            item = dict(team)
            if str(item.get("id")) == str(team_id):
                item["name"] = name
                found = True
            teams.append(item)
        updates[field] = teams
    if not found:
        raise PhysicalFootballError("Team was not found.", status_code=404, code="team_not_found")
    updates["updated_at"] = utc_now()
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": session["status"]}, {"$set": updates}
    )
    get_physical_football_teams_collection(config=config).update_one(
        {"team_id": str(team_id)},
        {"$set": {"current_name": name, "updated_at": utc_now()}},
        upsert=False,
    )
    return get_session(config, session_id)


def _duration(value, *, minimum, maximum, label):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise PhysicalFootballError(f"{label} must be a whole number of minutes.", code="invalid_duration") from error
    if parsed < minimum or parsed > maximum:
        raise PhysicalFootballError(f"{label} must be between {minimum} and {maximum} minutes.", code="invalid_duration")
    return parsed


def configure_live_session(config, session_id, payload, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    if session.get("status") != "teams_confirmed":
        raise PhysicalFootballError("Teams must be confirmed before configuring live play.", status_code=409, code="teams_not_confirmed")
    existing = session.get("live_state") or {}
    if existing.get("status") in {"live", "ended"}:
        raise PhysicalFootballError("Live format is locked after the session starts.", status_code=409, code="live_state_locked")
    teams = session.get("confirmed_teams") or []
    format_name = str(payload.get("format") or "").strip().lower()
    if format_name not in LIVE_FORMATS:
        raise PhysicalFootballError("Format must be Winner Stays or Head-to-Head.", code="invalid_live_format")
    if format_name == "winner_stays" and len(teams) < 3:
        raise PhysicalFootballError("Winner Stays requires at least three teams.", code="winner_stays_requires_three_teams")
    if format_name == "head_to_head" and len(teams) != 2:
        raise PhysicalFootballError("Head-to-Head requires exactly two teams.", code="head_to_head_requires_two_teams")
    match_duration = None
    if format_name == "winner_stays":
        match_duration = _duration(payload.get("match_duration_minutes"), minimum=1, maximum=120, label="Match duration")
    session_duration = _duration(payload.get("session_duration_minutes"), minimum=5, maximum=480, label="Session duration")
    team_ids = [str(team["id"]) for team in teams]
    live_state = {
        "format": format_name,
        "status": "configured",
        "match_duration_minutes": match_duration,
        "session_duration_minutes": session_duration,
        "team_ids": team_ids,
        "current_match": None,
        "waiting_queue": [],
        "matches": [],
        "standings": [
            {"team_id": team_id, "played": 0, "won": 0, "lost": 0, "goals_for": 0, "goals_against": 0, "goal_difference": 0, "points": 0}
            for team_id in team_ids
        ],
        "cumulative_score": {team_ids[0]: 0, team_ids[1]: 0} if format_name == "head_to_head" else {},
        "configured_at": utc_now(),
        "configured_by": str(actor["_id"]),
        "revision": 0,
    }
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "status": "teams_confirmed"},
        {"$set": {"live_state": live_state, "updated_at": utc_now()}},
    )
    return get_session(config, session_id)


def start_live_session(config, session_id, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    state = dict(session.get("live_state") or {})
    if session.get("status") != "teams_confirmed" or state.get("status") != "configured":
        raise PhysicalFootballError("Live play is not ready to start.", status_code=409, code="live_state_not_ready")
    now = utc_now()
    revision = int(state.get("revision") or 0)
    state.update({"status": "live", "started_at": now, "started_by": str(actor["_id"]), "goal_events": [], "player_stats": {}})
    team_ids = state["team_ids"]
    state["current_match"] = {
        "id": uuid4().hex, "team_ids": team_ids[:2], "started_at": now,
        "score": {team_ids[0]: 0, team_ids[1]: 0},
    }
    if state["format"] == "winner_stays":
        state["waiting_queue"] = team_ids[2:]
    state["revision"] = revision + 1
    get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.status": "configured", "live_state.revision": revision},
        {"$set": {"live_state": state, "updated_at": now}},
    )
    return get_session(config, session_id)


def _score(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise PhysicalFootballError("Scores must be whole numbers.", code="invalid_score") from error
    if parsed < 0 or parsed > 99:
        raise PhysicalFootballError("Scores must be between 0 and 99.", code="invalid_score")
    return parsed


def _elapsed_seconds(started_at, now=None):
    if not isinstance(started_at, datetime):
        return 0
    started_at = started_at.replace(tzinfo=timezone.utc) if started_at.tzinfo is None else started_at
    return max(0, int(((now or utc_now()) - started_at).total_seconds()))


def _event_score(state, match_id, team_ids):
    score = {team_id: 0 for team_id in team_ids}
    for event in state.get("goal_events") or []:
        if event.get("match_id") == match_id and event.get("status") == "confirmed" and event.get("team_id") in score:
            score[event["team_id"]] += 1
    adjustment = (state.get("score_corrections") or {}).get(match_id) or {}
    return {team_id: max(0, score[team_id] + int(adjustment.get(team_id, 0))) for team_id in team_ids}


def _refresh_official_totals(state):
    current = state.get("current_match") or {}
    current_ids = current.get("team_ids") or []
    if current.get("id") and len(current_ids) == 2:
        current["score"] = _event_score(state, current["id"], current_ids)
        state["current_match"] = current
        if state.get("format") == "head_to_head":
            state["cumulative_score"] = dict(current["score"])
    player_stats = {}
    for event in state.get("goal_events") or []:
        if event.get("status") != "confirmed":
            continue
        scorer = event.get("scorer_id")
        assist = event.get("assist_id")
        if scorer:
            player_stats.setdefault(scorer, {"goals": 0, "assists": 0})["goals"] += 1
        if assist:
            player_stats.setdefault(assist, {"goals": 0, "assists": 0})["assists"] += 1
    state["player_stats"] = player_stats
    return state


def _current_team_for_player(session, state, player_id):
    active_team_ids = set((state.get("current_match") or {}).get("team_ids") or [])
    for team in session.get("confirmed_teams") or []:
        if team.get("id") in active_team_ids and str(player_id) in {str(value) for value in team.get("player_ids") or []}:
            return team
    return None


def _validate_goal_people(session, state, scorer_id, assist_id=None):
    scorer_id = str(scorer_id or "").strip()
    assist_id = str(assist_id or "").strip() or None
    scorer_team = _current_team_for_player(session, state, scorer_id)
    if not scorer_team:
        raise PhysicalFootballError("Scorer must be a player in the current match.", code="invalid_scorer")
    if assist_id:
        if assist_id == scorer_id or assist_id not in {str(value) for value in scorer_team.get("player_ids") or []}:
            raise PhysicalFootballError("Assist must be a different player on the scorer's team.", code="invalid_assist")
    return scorer_id, assist_id, str(scorer_team["id"])


def _event_time(value, *, maximum):
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise PhysicalFootballError("Event time must be a whole number of seconds.", code="invalid_event_time") from error
    if parsed < 0 or parsed > maximum:
        raise PhysicalFootballError("Event time must fall within the elapsed match time.", code="invalid_event_time")
    return parsed


def record_goal_event(config, session_id, payload, actor):
    session = get_session(config, session_id)
    state = dict(session.get("live_state") or {})
    current = dict(state.get("current_match") or {})
    if state.get("status") != "live" or not current.get("id"):
        raise PhysicalFootballError("There is no live match to report.", status_code=409, code="live_match_not_active")
    direct = bool(payload.get("direct"))
    if direct:
        require_coordinator(config, session, actor)
    elif not _current_team_for_player(session, state, actor.get("_id")):
        raise PhysicalFootballError("Only a player in the current match may report a goal.", status_code=403, code="current_match_player_required")
    scorer_id, assist_id, team_id = _validate_goal_people(
        session, state, payload.get("scorer_id"), payload.get("assist_id")
    )
    now = utc_now()
    elapsed = _elapsed_seconds(current.get("started_at"), now)
    before = _event_score(state, current["id"], current["team_ids"])
    after = dict(before)
    after[team_id] += 1
    event = {
        "id": uuid4().hex,
        "match_id": current["id"],
        "team_id": team_id,
        "scorer_id": scorer_id,
        "assist_id": assist_id,
        "status": "confirmed" if direct else "pending",
        "elapsed_seconds": elapsed,
        "created_at": now,
        "reported_by": str(actor["_id"]),
        "score_before": before,
        "score_after": after,
    }
    if direct:
        event.update({"confirmed_at": now, "confirmed_by": str(actor["_id"]), "source": "coordinator"})
    else:
        event["source"] = "player_report"
    state["goal_events"] = [*(state.get("goal_events") or []), event]
    _refresh_official_totals(state)
    revision = int(state.get("revision") or 0)
    state["revision"] = revision + 1
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.status": "live", "live_state.current_match.id": current["id"], "live_state.revision": revision, "live_state.goal_events.id": {"$ne": event["id"]}},
        {"$set": {"live_state": state, "updated_at": now}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("The live match changed before the goal was saved.", status_code=409, code="current_match_changed")
    return get_session(config, session_id)


def review_goal_event(config, session_id, event_id, payload, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    state = dict(session.get("live_state") or {})
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"confirm", "edit", "reject"}:
        raise PhysicalFootballError("Action must be confirm, edit, or reject.", code="invalid_event_action")
    events = [dict(item) for item in state.get("goal_events") or []]
    event = next((item for item in events if item.get("id") == str(event_id)), None)
    if not event:
        raise PhysicalFootballError("Goal event was not found.", status_code=404, code="goal_event_not_found")
    previous_status = event.get("status")
    if action == "confirm" and previous_status != "pending":
        raise PhysicalFootballError("Only a pending goal can be confirmed.", status_code=409, code="goal_event_already_reviewed")
    if action == "reject" and event.get("status") == "rejected":
        raise PhysicalFootballError("Goal event is already rejected.", status_code=409, code="goal_event_already_reviewed")
    if action == "edit":
        scorer_id, assist_id, team_id = _validate_goal_people(
            session, state, payload.get("scorer_id", event.get("scorer_id")), payload.get("assist_id", event.get("assist_id"))
        )
        event.update({"scorer_id": scorer_id, "assist_id": assist_id, "team_id": team_id})
        if "elapsed_seconds" in payload:
            event["elapsed_seconds"] = _event_time(
                payload["elapsed_seconds"], maximum=_elapsed_seconds((state.get("current_match") or {}).get("started_at"))
            )
        event.update({"edited_at": utc_now(), "edited_by": str(actor["_id"])})
        team_ids = (state.get("current_match") or {}).get("team_ids") or state.get("team_ids") or []
        without_event = {**state, "goal_events": [item for item in events if item.get("id") != event["id"]]}
        before = _event_score(without_event, event["match_id"], team_ids)
        after = dict(before)
        after[event["team_id"]] = after.get(event["team_id"], 0) + 1
        event.update({"score_before": before, "score_after": after})
    now = utc_now()
    if action == "confirm":
        before = _event_score(state, event["match_id"], (state.get("current_match") or {}).get("team_ids") or state.get("team_ids") or [])
        after = dict(before)
        after[event["team_id"]] = after.get(event["team_id"], 0) + 1
        event.update({"status": "confirmed", "confirmed_at": now, "confirmed_by": str(actor["_id"]), "score_before": before, "score_after": after})
    elif action == "reject":
        event.update({"status": "rejected", "rejected_at": now, "rejected_by": str(actor["_id"])})
    state["goal_events"] = events
    _refresh_official_totals(state)
    revision = int(state.get("revision") or 0)
    state["revision"] = revision + 1
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.revision": revision, "live_state.goal_events": {"$elemMatch": {"id": str(event_id), "status": previous_status}}},
        {"$set": {"live_state": state, "updated_at": now}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("The goal changed before the review was saved.", status_code=409, code="goal_event_changed")
    return get_session(config, session_id)


def correct_current_score(config, session_id, payload, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    state = dict(session.get("live_state") or {})
    current = state.get("current_match") or {}
    if state.get("status") != "live" or len(current.get("team_ids") or []) != 2:
        raise PhysicalFootballError("There is no live score to correct.", status_code=409, code="live_match_not_active")
    team_ids = current["team_ids"]
    desired = {team_ids[0]: _score(payload.get("team_one_score")), team_ids[1]: _score(payload.get("team_two_score"))}
    raw = _event_score({**state, "score_corrections": {}}, current["id"], team_ids)
    corrections = dict(state.get("score_corrections") or {})
    corrections[current["id"]] = {team_id: desired[team_id] - raw[team_id] for team_id in team_ids}
    state.update({"score_corrections": corrections, "score_updated_at": utc_now(), "score_updated_by": str(actor["_id"])})
    _refresh_official_totals(state)
    revision = int(state.get("revision") or 0)
    state["revision"] = revision + 1
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.status": "live", "live_state.current_match.id": current["id"], "live_state.revision": revision},
        {"$set": {"live_state": state, "updated_at": utc_now()}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("The score changed before the correction was saved.", status_code=409, code="live_state_changed")
    return get_session(config, session_id)


def record_winner_stays_result(config, session_id, match_id, payload, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    state = dict(session.get("live_state") or {})
    current = dict(state.get("current_match") or {})
    if state.get("format") != "winner_stays" or state.get("status") != "live" or current.get("id") != str(match_id):
        raise PhysicalFootballError("The current Winner Stays match was not found.", status_code=409, code="current_match_changed")
    first_id, second_id = current["team_ids"]
    if payload.get("team_one_score") is not None or payload.get("team_two_score") is not None:
        desired = {first_id: _score(payload.get("team_one_score")), second_id: _score(payload.get("team_two_score"))}
        raw = _event_score({**state, "score_corrections": {}}, current["id"], current["team_ids"])
        corrections = dict(state.get("score_corrections") or {})
        corrections[current["id"]] = {team_id: desired[team_id] - raw[team_id] for team_id in current["team_ids"]}
        state["score_corrections"] = corrections
    _refresh_official_totals(state)
    current = dict(state["current_match"])
    first_score = current["score"][first_id]
    second_score = current["score"][second_id]
    if first_score == second_score:
        raise PhysicalFootballError("Winner Stays matches require a winner.", code="winner_required")
    winner_id, loser_id = (first_id, second_id) if first_score > second_score else (second_id, first_id)
    now = utc_now()
    completed = {
        **current,
        "team_one_score": first_score,
        "team_two_score": second_score,
        "winner_id": winner_id,
        "loser_id": loser_id,
        "ended_at": now,
        "confirmed_by": str(actor["_id"]),
    }
    standings = []
    for row in state.get("standings") or []:
        item = dict(row)
        if item["team_id"] in {first_id, second_id}:
            item["played"] += 1
            own, against = (first_score, second_score) if item["team_id"] == first_id else (second_score, first_score)
            item["goals_for"] += own
            item["goals_against"] += against
            if item["team_id"] == winner_id:
                item["won"] += 1
                item["points"] += 3
            else:
                item["lost"] += 1
            item["goal_difference"] = item["goals_for"] - item["goals_against"]
        standings.append(item)
    waiting = list(state.get("waiting_queue") or [])
    next_team = waiting.pop(0)
    waiting.append(loser_id)
    state.update({
        "matches": [*(state.get("matches") or []), completed],
        "standings": standings,
        "waiting_queue": waiting,
        "current_match": {"id": uuid4().hex, "team_ids": [winner_id, next_team], "started_at": now, "score": {winner_id: 0, next_team: 0}},
    })
    revision = int(state.get("revision") or 0)
    state["revision"] = revision + 1
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.status": "live", "live_state.current_match.id": str(match_id), "live_state.revision": revision},
        {"$set": {"live_state": state, "updated_at": now}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("The current match changed before the result was saved.", status_code=409, code="current_match_changed")
    return get_session(config, session_id)


def update_winner_stays_queue(config, session_id, team_ids, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    state = dict(session.get("live_state") or {})
    if state.get("format") != "winner_stays" or state.get("status") != "live":
        raise PhysicalFootballError("Winner Stays is not live.", status_code=409, code="winner_stays_not_live")
    normalized = [str(value) for value in (team_ids or [])]
    current_queue = list(state.get("waiting_queue") or [])
    if len(normalized) != len(set(normalized)) or set(normalized) != set(current_queue):
        raise PhysicalFootballError("Queue must contain every waiting team exactly once.", code="invalid_waiting_queue")
    state["waiting_queue"] = normalized
    state["queue_updated_at"] = utc_now()
    state["queue_updated_by"] = str(actor["_id"])
    revision = int(state.get("revision") or 0)
    state["revision"] = revision + 1
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.status": "live", "live_state.revision": revision},
        {"$set": {"live_state": state, "updated_at": utc_now()}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("The live match changed before the queue was saved.", status_code=409, code="live_state_changed")
    return get_session(config, session_id)


def update_head_to_head_score(config, session_id, payload, actor):
    return correct_current_score(config, session_id, payload, actor)


def end_live_session(config, session_id, actor):
    session = get_session(config, session_id)
    require_coordinator(config, session, actor)
    state = dict(session.get("live_state") or {})
    if state.get("status") != "live":
        raise PhysicalFootballError("Live play is not active.", status_code=409, code="live_state_not_active")
    if state.get("format") == "head_to_head":
        _refresh_official_totals(state)
        first_id, second_id = state["team_ids"]
        first_score = state.get("cumulative_score", {}).get(first_id, 0)
        second_score = state.get("cumulative_score", {}).get(second_id, 0)
        if first_score == second_score:
            raise PhysicalFootballError("Head-to-Head must have a higher-scoring winner before it ends.", code="winner_required")
        state["winner_id"] = first_id if first_score > second_score else second_id
        state["final_result"] = {
            "team_one_score": first_score, "team_two_score": second_score,
            "winner_id": state["winner_id"], "stored_at": utc_now(),
        }
    elif state.get("format") == "winner_stays":
        ordered = sorted(
            state.get("standings") or [],
            key=lambda row: (-row["points"], -row["goal_difference"], -row["goals_for"], row["team_id"]),
        )
        state["winner_id"] = ordered[0]["team_id"] if ordered else None
    now = utc_now()
    state.update({"status": "ended", "ended_at": now, "ended_by": str(actor["_id"])})
    revision = int(state.get("revision") or 0)
    state["revision"] = revision + 1
    result = get_physical_football_sessions_collection(config=config).update_one(
        {"_id": session["_id"], "live_state.status": "live", "live_state.revision": revision},
        {"$set": {"live_state": state, "updated_at": now}},
    )
    if result.modified_count != 1:
        raise PhysicalFootballError("Live play changed before the session could end.", status_code=409, code="live_state_changed")
    return get_session(config, session_id)
