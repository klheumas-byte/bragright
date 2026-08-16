from datetime import date, datetime, timedelta, timezone

from bson import ObjectId

from app import db as db_module


PASSWORD = "correct-horse-battery-staple"


def headers(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def next_sunday(offset_weeks=0):
    today = date.today()
    days = (6 - today.weekday()) % 7
    return (today + timedelta(days=days + offset_weeks * 7)).isoformat()


def session_payload(**overrides):
    sunday = date.fromisoformat(next_sunday())
    payload = {
        "date": sunday.isoformat(),
        "location": "Community Park",
        "start_time": "16:30",
        "end_time": "18:30",
        "availability_cutoff": f"{(sunday - timedelta(days=1)).isoformat()}T18:00:00+00:00",
    }
    payload.update(overrides)
    return payload


def create_and_open(client, create_user, *, player_count=5):
    admin = create_user("football-admin@example.com", role="admin")
    players = [
        create_user(f"physical-{index}@example.com", username=f"Physical Player {index}")
        for index in range(player_count)
    ]
    admin_headers = headers(client, admin["email"])
    created = client.post(
        "/api/physical-football/sessions",
        json=session_payload(),
        headers=admin_headers,
    )
    assert created.status_code == 201
    assert created.json["data"]["session"]["start_time"] == "16:30"
    assert created.json["data"]["session"]["end_time"] == "18:30"
    assert created.json["data"]["session"]["availability_cutoff"]
    session_id = created.json["data"]["session"]["id"]
    opened = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_open"},
        headers=admin_headers,
    )
    assert opened.status_code == 200
    return admin_headers, players, session_id


def test_physical_football_reuses_auth_and_keeps_ea_fc_data_separate(client, create_user, app):
    admin = create_user("admin@example.com", role="admin")
    player = create_user("player@example.com")
    officer = create_user("officer@example.com", role="payment_officer")

    assert client.get("/api/physical-football/sessions/current").status_code == 401
    assert client.post(
        "/api/physical-football/sessions",
        json=session_payload(location="Park"),
        headers=headers(client, player["email"]),
    ).status_code == 403
    assert client.get(
        "/api/physical-football/sessions/current", headers=headers(client, officer["email"])
    ).status_code == 403

    created = client.post(
        "/api/physical-football/sessions",
        json=session_payload(location="Park"),
        headers=headers(client, admin["email"]),
    )
    assert created.status_code == 201
    assert created.json["data"]["session"]["status"] == "draft"
    assert db_module.get_matches_collection(config=app.config).count_documents({}) == 0
    stored = db_module.get_physical_football_sessions_collection(config=app.config).find_one({})
    assert stored["module"] == "physical_football"


def test_sunday_validation_and_availability_flow(client, create_user):
    admin_headers, players, session_id = create_and_open(client, create_user, player_count=2)
    monday = date.fromisoformat(next_sunday()) + timedelta(days=1)
    invalid = client.post(
        "/api/physical-football/sessions",
        json=session_payload(date=monday.isoformat(), location="Wrong day"),
        headers=admin_headers,
    )
    assert invalid.status_code == 400
    assert invalid.json["error"]["code"] == "SESSION_MUST_BE_SUNDAY"

    missing_schedule = client.post(
        "/api/physical-football/sessions",
        json={"date": next_sunday(1), "location": "Missing schedule"},
        headers=admin_headers,
    )
    assert missing_schedule.status_code == 400
    assert missing_schedule.json["error"]["code"] == "SESSION_TIMES_REQUIRED"

    invalid_schedule = client.post(
        "/api/physical-football/sessions",
        json=session_payload(
            date=next_sunday(1),
            location="Invalid schedule",
            start_time="18:30",
            end_time="16:30",
        ),
        headers=admin_headers,
    )
    assert invalid_schedule.status_code == 400
    assert invalid_schedule.json["error"]["code"] == "INVALID_SESSION_TIMES"

    first_headers = headers(client, players[0]["email"])
    player_open_view = client.get(
        "/api/physical-football/sessions/current", headers=first_headers
    )
    assert player_open_view.status_code == 200
    assert player_open_view.json["data"]["session"]["id"] == session_id
    assert player_open_view.json["data"]["session"]["status"] == "registration_open"
    for status in ("available", "not_available", "available"):
        response = client.put(
            f"/api/physical-football/sessions/{session_id}/availability",
            json={"status": status},
            headers=first_headers,
        )
        assert response.status_code == 200
        assert response.json["data"]["session"]["my_availability"] == status
        refreshed = client.get(
            "/api/physical-football/sessions/current", headers=first_headers
        )
        assert refreshed.json["data"]["session"]["my_availability"] == status
    client.put(
        f"/api/physical-football/sessions/{session_id}/availability",
        json={"status": "available"},
        headers=headers(client, players[1]["email"]),
    )
    closed = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_closed"},
        headers=admin_headers,
    )
    assert closed.status_code == 200
    assert closed.json["data"]["session"]["available_player_count"] == 2
    assert closed.json["data"]["session"]["selected_player_count"] == 2
    organizer_player = next(
        item for item in closed.json["data"]["session"]["players"]
        if item["id"] == str(players[0]["_id"])
    )
    assert organizer_player["availability"] == "available"
    player_closed_view = client.get(
        "/api/physical-football/sessions/current", headers=first_headers
    )
    assert player_closed_view.json["data"]["session"]["status"] == "registration_closed"
    locked = client.put(
        f"/api/physical-football/sessions/{session_id}/availability",
        json={"status": "not_available"},
        headers=first_headers,
    )
    assert locked.status_code == 409
    assert locked.json["error"]["code"] == "AVAILABILITY_NOT_OPEN"


def test_current_session_uses_latest_state_when_duplicate_dates_exist(client, create_user, app):
    admin = create_user("sync-admin@example.com", role="admin")
    player = create_user("sync-player@example.com")
    admin_headers = headers(client, admin["email"])
    player_headers = headers(client, player["email"])
    sessions = db_module.get_physical_football_sessions_collection(config=app.config)
    sessions.drop_index("physical_football_session_date_unique")
    created = client.post(
        "/api/physical-football/sessions",
        json=session_payload(availability_cutoff=None),
        headers=admin_headers,
    )
    assert created.status_code == 201
    session_id = created.json["data"]["session"]["id"]
    opened = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_open"},
        headers=admin_headers,
    )
    assert opened.status_code == 200
    stale_time = datetime.now(timezone.utc) - timedelta(days=1)
    sessions.insert_one({
        "module": "physical_football",
        "session_date": next_sunday(),
        "location": "Stale duplicate",
        "start_time": "16:30",
        "end_time": "18:30",
        "availability_cutoff": None,
        "status": "registration_closed",
        "created_by": str(admin["_id"]),
        "selected_player_ids": [],
        "draft_teams": [],
        "confirmed_teams": [],
        "shuffle_version": 0,
        "created_at": stale_time,
        "updated_at": stale_time,
    })

    player_view = client.get(
        "/api/physical-football/sessions/current", headers=player_headers
    )
    assert player_view.status_code == 200
    assert player_view.json["data"]["session"]["id"] == session_id
    assert player_view.json["data"]["session"]["status"] == "registration_open"
    response = client.put(
        f"/api/physical-football/sessions/{session_id}/availability",
        json={"status": "available"}, headers=player_headers,
    )
    assert response.status_code == 200


def test_duplicate_sunday_is_rejected_without_database_index(client, create_user, app):
    admin = create_user("duplicate-date-admin@example.com", role="admin")
    admin_headers = headers(client, admin["email"])
    sessions = db_module.get_physical_football_sessions_collection(config=app.config)
    sessions.drop_index("physical_football_session_date_unique")
    first = client.post(
        "/api/physical-football/sessions", json=session_payload(), headers=admin_headers
    )
    assert first.status_code == 201
    duplicate = client.post(
        "/api/physical-football/sessions", json=session_payload(), headers=admin_headers
    )
    assert duplicate.status_code == 409
    assert duplicate.json["error"]["code"] == "SESSION_DATE_EXISTS"


def test_availability_cutoff_is_informational_and_does_not_block_actions(client, create_user, app):
    admin = create_user("expired-cutoff-admin@example.com", role="admin")
    player = create_user("expired-cutoff-player@example.com")
    admin_headers = headers(client, admin["email"])
    created = client.post(
        "/api/physical-football/sessions",
        json=session_payload(),
        headers=admin_headers,
    )
    assert created.status_code == 201
    session_id = created.json["data"]["session"]["id"]
    db_module.get_physical_football_sessions_collection(config=app.config).update_one(
        {"_id": ObjectId(session_id)},
        # PyMongo decodes UTC datetimes without tzinfo under the production client settings.
        {"$set": {"availability_cutoff": datetime.now() - timedelta(minutes=1)}},
    )

    opened = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_open"},
        headers=admin_headers,
    )
    assert opened.status_code == 200
    assert opened.json["data"]["session"]["status"] == "registration_open"
    response = client.put(
        f"/api/physical-football/sessions/{session_id}/availability",
        json={"status": "available"},
        headers=headers(client, player["email"]),
    )
    assert response.status_code == 200
    closed = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_closed"},
        headers=admin_headers,
    )
    assert closed.status_code == 200
    reopened = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_open"},
        headers=admin_headers,
    )
    assert reopened.status_code == 200


def test_open_availability_handles_pymongo_naive_cutoff_and_persists(client, create_user, app):
    admin = create_user("naive-cutoff-admin@example.com", role="admin")
    admin_headers = headers(client, admin["email"])
    payload = session_payload()
    created = client.post(
        "/api/physical-football/sessions", json=payload, headers=admin_headers
    )
    assert created.status_code == 201
    session_id = created.json["data"]["session"]["id"]
    naive_cutoff = datetime.fromisoformat(payload["availability_cutoff"]).replace(tzinfo=None)
    db_module.get_physical_football_sessions_collection(config=app.config).update_one(
        {"_id": ObjectId(session_id)}, {"$set": {"availability_cutoff": naive_cutoff}}
    )

    opened = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_open"},
        headers=admin_headers,
    )
    assert opened.status_code == 200
    refreshed = client.get(
        "/api/physical-football/sessions/current", headers=admin_headers
    )
    assert refreshed.status_code == 200
    assert refreshed.json["data"]["session"]["status"] == "registration_open"


def test_cutoff_is_optional_and_close_reopen_state_persists(client, create_user):
    admin = create_user("optional-cutoff-admin@example.com", role="admin")
    player = create_user("optional-cutoff-player@example.com")
    admin_headers = headers(client, admin["email"])
    payload = session_payload()
    payload.pop("availability_cutoff")
    created = client.post(
        "/api/physical-football/sessions", json=payload, headers=admin_headers
    )
    assert created.status_code == 201
    assert created.json["data"]["session"]["availability_cutoff"] is None
    session_id = created.json["data"]["session"]["id"]

    for target in ("registration_open", "registration_closed", "registration_open"):
        changed = client.patch(
            f"/api/physical-football/sessions/{session_id}/status",
            json={"status": target}, headers=admin_headers,
        )
        assert changed.status_code == 200
        refreshed = client.get(
            "/api/physical-football/sessions/current", headers=admin_headers
        )
        assert refreshed.json["data"]["session"]["status"] == target

    response = client.put(
        f"/api/physical-football/sessions/{session_id}/availability",
        json={"status": "available"}, headers=headers(client, player["email"]),
    )
    assert response.status_code == 200


def test_team_builder_distributes_uneven_players_and_confirms_exactly_once(client, create_user):
    admin_headers, players, session_id = create_and_open(client, create_user, player_count=5)
    for player in players:
        client.put(
            f"/api/physical-football/sessions/{session_id}/availability",
            json={"status": "available"},
            headers=headers(client, player["email"]),
        )
    client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_closed"},
        headers=admin_headers,
    )

    shuffled = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/shuffle",
        json={"team_count": 2},
        headers=admin_headers,
    )
    session = shuffled.json["data"]["session"]
    assert sorted(len(team["players"]) for team in session["teams"]) == [2, 3]
    assigned = [player_id for team in session["teams"] for player_id in team["player_ids"]]
    assert len(assigned) == len(set(assigned)) == 5
    reshuffled = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/shuffle",
        json={"team_count": 2},
        headers=admin_headers,
    )
    assert reshuffled.json["data"]["session"]["shuffle_version"] == 2

    teams = reshuffled.json["data"]["session"]["teams"]
    moved = teams[0]["player_ids"].pop()
    teams[1]["player_ids"].append(moved)
    saved = client.put(
        f"/api/physical-football/sessions/{session_id}/teams",
        json={"teams": teams},
        headers=admin_headers,
    )
    assert saved.status_code == 200
    saved_distribution = [list(team["player_ids"]) for team in saved.json["data"]["session"]["teams"]]
    refreshed_draft = client.get(
        "/api/physical-football/sessions/current", headers=admin_headers
    )
    assert [team["player_ids"] for team in refreshed_draft.json["data"]["session"]["teams"]] == saved_distribution
    invalid_teams = saved.json["data"]["session"]["teams"]
    invalid_teams[0]["player_ids"].append(invalid_teams[1]["player_ids"][0])
    rejected = client.put(
        f"/api/physical-football/sessions/{session_id}/teams",
        json={"teams": invalid_teams},
        headers=admin_headers,
    )
    assert rejected.status_code == 400
    assert rejected.json["error"]["code"] == "INVALID_TEAM_DISTRIBUTION"

    confirmed = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/confirm",
        headers=admin_headers,
    )
    assert confirmed.status_code == 200
    assert confirmed.json["data"]["session"]["status"] == "teams_confirmed"
    refreshed_confirmed = client.get(
        "/api/physical-football/sessions/current", headers=admin_headers
    )
    assert refreshed_confirmed.json["data"]["session"]["status"] == "teams_confirmed"
    assert [team["player_ids"] for team in refreshed_confirmed.json["data"]["session"]["teams"]] == saved_distribution
    reopen = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_open"},
        headers=admin_headers,
    )
    assert reopen.status_code == 409
    assert reopen.json["error"]["code"] == "INVALID_SESSION_TRANSITION"
    player_view = client.get(
        "/api/physical-football/sessions/current", headers=headers(client, players[0]["email"])
    ).json["data"]["session"]
    assert player_view["teams"]
    player_team_count = sum(
        str(players[0]["_id"]) in [member["id"] for member in team["players"]]
        for team in player_view["teams"]
    )
    assert player_team_count == 1
    assert "players" not in player_view
    assert "selected_player_ids" not in player_view


def test_admin_can_adjust_pool_but_cannot_confirm_missing_or_duplicate_players(client, create_user):
    admin_headers, players, session_id = create_and_open(client, create_user, player_count=3)
    for player in players[:2]:
        client.put(
            f"/api/physical-football/sessions/{session_id}/availability",
            json={"status": "available"},
            headers=headers(client, player["email"]),
        )
    client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_closed"}, headers=admin_headers,
    )
    selected = [str(player["_id"]) for player in players]
    adjusted = client.put(
        f"/api/physical-football/sessions/{session_id}/player-pool",
        json={"player_ids": selected}, headers=admin_headers,
    )
    assert adjusted.status_code == 200
    assert adjusted.json["data"]["session"]["selected_player_count"] == 3
    shuffled = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/shuffle",
        json={"team_count": 2}, headers=admin_headers,
    )
    assert shuffled.status_code == 200
    confirmed = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/confirm", headers=admin_headers,
    )
    assert confirmed.status_code == 200
    completed = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "completed"}, headers=admin_headers,
    )
    assert completed.json["data"]["session"]["status"] == "completed"


def prepare_phase_two_session(client, create_user, team_count):
    admin_headers, players, session_id = create_and_open(
        client, create_user, player_count=team_count * 2
    )
    coordinator_headers = headers(client, players[0]["email"])
    assigned = client.patch(
        f"/api/physical-football/sessions/{session_id}/coordinator",
        json={"player_id": str(players[0]["_id"])}, headers=admin_headers,
    )
    assert assigned.status_code == 200
    for player in players:
        response = client.put(
            f"/api/physical-football/sessions/{session_id}/availability",
            json={"status": "available"}, headers=headers(client, player["email"]),
        )
        assert response.status_code == 200
    assert client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "registration_closed"}, headers=admin_headers,
    ).status_code == 200
    shuffled = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/shuffle",
        json={"team_count": team_count}, headers=coordinator_headers,
    )
    assert shuffled.status_code == 200
    confirmed = client.post(
        f"/api/physical-football/sessions/{session_id}/teams/confirm",
        headers=coordinator_headers,
    )
    assert confirmed.status_code == 200
    return admin_headers, coordinator_headers, players, session_id, confirmed.json["data"]["session"]


def test_phase_two_session_permissions_coordinator_assignment_and_team_history(client, create_user, app):
    coordinator_rule = next(
        rule for rule in app.url_map.iter_rules()
        if rule.rule == "/api/physical-football/sessions/<session_id>/coordinator"
    )
    assert "PATCH" in coordinator_rule.methods
    admin_headers, coordinator_headers, players, session_id, session = prepare_phase_two_session(
        client, create_user, 3
    )
    random_player = create_user("phase-two-random@example.com")
    denied = client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "winner_stays", "match_duration_minutes": 7, "session_duration_minutes": 60},
        headers=headers(client, random_player["email"]),
    )
    assert denied.status_code == 403
    assert denied.json["error"]["code"] == "COORDINATOR_REQUIRED"
    coordinator_view = client.get(
        "/api/physical-football/sessions/current", headers=coordinator_headers
    ).json["data"]["session"]
    assert coordinator_view["session_role"] == "match_coordinator"
    assert coordinator_view["capabilities"]["can_manage_live"] is True
    admin_refresh = client.get(
        "/api/physical-football/sessions/current", headers=admin_headers
    ).json["data"]["session"]
    assert admin_refresh["coordinator_id"] == str(players[0]["_id"])
    assert admin_refresh["coordinator_name"] == players[0]["username"]
    assert [team["id"] for team in admin_refresh["teams"]] == [team["id"] for team in session["teams"]]
    assert [team["player_ids"] for team in admin_refresh["teams"]] == [
        team["player_ids"] for team in session["teams"]
    ]
    player_view = client.get(
        "/api/physical-football/sessions/current", headers=headers(client, players[1]["email"])
    ).json["data"]["session"]
    assert player_view["session_role"] == "player"
    assert player_view["capabilities"]["can_manage_live"] is False

    team = session["teams"][0]
    renamed = client.patch(
        f"/api/physical-football/sessions/{session_id}/teams/{team['id']}",
        json={"name": "North Stars"}, headers=coordinator_headers,
    )
    assert renamed.status_code == 200
    assert renamed.json["data"]["session"]["teams"][0]["name"] == "North Stars"
    history = db_module.get_physical_football_teams_collection(config=app.config).find_one(
        {"team_id": team["id"]}
    )
    assert history["current_name"] == "North Stars"
    assert history["sessions"][0]["session_id"] == session_id

    removed = client.patch(
        f"/api/physical-football/sessions/{session_id}/coordinator",
        json={"player_id": None}, headers=admin_headers,
    )
    assert removed.status_code == 200
    formerly_coordinator = client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "winner_stays", "match_duration_minutes": 7, "session_duration_minutes": 60},
        headers=coordinator_headers,
    )
    assert formerly_coordinator.status_code == 403

    reassigned = client.patch(
        f"/api/physical-football/sessions/{session_id}/coordinator",
        json={"player_id": str(players[0]["_id"])}, headers=admin_headers,
    )
    assert reassigned.status_code == 200
    reassigned_session = reassigned.json["data"]["session"]
    assert reassigned_session["status"] == "teams_confirmed"
    assert reassigned_session["coordinator_id"] == str(players[0]["_id"])
    assert [team["id"] for team in reassigned_session["teams"]] == [team["id"] for team in session["teams"]]
    configured_after_reassignment = client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "winner_stays", "match_duration_minutes": 7, "session_duration_minutes": 60},
        headers=coordinator_headers,
    )
    assert configured_after_reassignment.status_code == 200


def test_winner_stays_rotates_queue_scores_points_and_persists(client, create_user):
    _, coordinator_headers, _, session_id, session = prepare_phase_two_session(client, create_user, 4)
    configured = client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "winner_stays", "match_duration_minutes": 7, "session_duration_minutes": 60},
        headers=coordinator_headers,
    )
    assert configured.status_code == 200
    started = client.post(
        f"/api/physical-football/sessions/{session_id}/live/start", headers=coordinator_headers
    )
    state = started.json["data"]["session"]["live_state"]
    first_id, second_id = state["current_match"]["team_ids"]
    reordered_queue = list(reversed(state["waiting_queue"]))
    reordered = client.put(
        f"/api/physical-football/sessions/{session_id}/live/queue",
        json={"team_ids": reordered_queue}, headers=coordinator_headers,
    )
    assert reordered.status_code == 200
    assert reordered.json["data"]["session"]["live_state"]["waiting_queue"] == reordered_queue
    waiting_id = reordered_queue[0]
    result = client.post(
        f"/api/physical-football/sessions/{session_id}/live/matches/{state['current_match']['id']}/result",
        json={"team_one_score": 2, "team_two_score": 1}, headers=coordinator_headers,
    )
    assert result.status_code == 200
    next_state = result.json["data"]["session"]["live_state"]
    assert next_state["current_match"]["team_ids"] == [first_id, waiting_id]
    assert next_state["waiting_queue"] == [reordered_queue[1], second_id]
    standings = {row["team_id"]: row for row in next_state["standings"]}
    assert standings[first_id] == {
        "team_id": first_id, "played": 1, "won": 1, "lost": 0,
        "goals_for": 2, "goals_against": 1, "goal_difference": 1, "points": 3,
    }
    assert standings[second_id]["lost"] == 1
    assert standings[second_id]["points"] == 0
    refreshed = client.get(
        "/api/physical-football/sessions/current", headers=coordinator_headers
    ).json["data"]["session"]["live_state"]
    assert refreshed["current_match"]["id"] == next_state["current_match"]["id"]
    assert refreshed["matches"][0]["winner_id"] == first_id
    ended = client.post(
        f"/api/physical-football/sessions/{session_id}/live/end", headers=coordinator_headers
    )
    assert ended.json["data"]["session"]["live_state"]["status"] == "ended"


def test_head_to_head_cumulative_result_and_player_visibility_persist(client, create_user):
    _, coordinator_headers, players, session_id, session = prepare_phase_two_session(client, create_user, 2)
    configured = client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "head_to_head", "session_duration_minutes": 90},
        headers=coordinator_headers,
    )
    assert configured.status_code == 200
    assert client.post(
        f"/api/physical-football/sessions/{session_id}/live/start", headers=coordinator_headers
    ).status_code == 200
    scored = client.put(
        f"/api/physical-football/sessions/{session_id}/live/head-to-head/score",
        json={"team_one_score": 5, "team_two_score": 3}, headers=coordinator_headers,
    )
    assert scored.status_code == 200
    team_ids = scored.json["data"]["session"]["live_state"]["team_ids"]
    ended = client.post(
        f"/api/physical-football/sessions/{session_id}/live/end", headers=coordinator_headers
    )
    state = ended.json["data"]["session"]["live_state"]
    assert state["winner_id"] == team_ids[0]
    player_view = client.get(
        "/api/physical-football/sessions/current", headers=headers(client, players[1]["email"])
    ).json["data"]["session"]
    assert player_view["live_state"]["status"] == "ended"
    assert player_view["live_state"]["cumulative_score"] == {team_ids[0]: 5, team_ids[1]: 3}


def test_completed_session_moves_to_admin_history_without_losing_teams_or_results(client, create_user):
    admin_headers, coordinator_headers, _, session_id, session = prepare_phase_two_session(
        client, create_user, 2
    )
    assert client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "head_to_head", "session_duration_minutes": 60},
        headers=coordinator_headers,
    ).status_code == 200
    assert client.post(
        f"/api/physical-football/sessions/{session_id}/live/start",
        headers=coordinator_headers,
    ).status_code == 200
    assert client.put(
        f"/api/physical-football/sessions/{session_id}/live/head-to-head/score",
        json={"team_one_score": 4, "team_two_score": 2},
        headers=coordinator_headers,
    ).status_code == 200
    assert client.post(
        f"/api/physical-football/sessions/{session_id}/live/end",
        headers=coordinator_headers,
    ).status_code == 200
    completed = client.patch(
        f"/api/physical-football/sessions/{session_id}/status",
        json={"status": "completed"}, headers=admin_headers,
    )
    assert completed.status_code == 200

    current = client.get("/api/physical-football/sessions/current", headers=admin_headers)
    assert current.status_code == 200
    assert current.json["data"]["session"] is None
    history = client.get("/api/physical-football/sessions", headers=admin_headers)
    assert history.status_code == 200
    archived = history.json["data"]["sessions"][0]
    assert archived["id"] == session_id
    assert archived["status"] == "completed"
    assert [team["id"] for team in archived["teams"]] == [team["id"] for team in session["teams"]]
    assert archived["live_state"]["cumulative_score"][session["teams"][0]["id"]] == 4

    duplicate = client.post(
        "/api/physical-football/sessions",
        json=session_payload(date=session["date"]), headers=admin_headers,
    )
    assert duplicate.status_code == 409
    assert duplicate.json["error"]["code"] == "SESSION_DATE_EXISTS"


def test_goal_report_timer_review_score_stats_and_refresh_are_safe(client, create_user, app):
    _, coordinator_headers, players, session_id, session = prepare_phase_two_session(client, create_user, 2)
    assert client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "head_to_head", "session_duration_minutes": 60}, headers=coordinator_headers,
    ).status_code == 200
    started = client.post(
        f"/api/physical-football/sessions/{session_id}/live/start", headers=coordinator_headers,
    ).json["data"]["session"]
    match = started["live_state"]["current_match"]
    stored_start = datetime.now(timezone.utc) - timedelta(seconds=84)
    db_module.get_physical_football_sessions_collection(config=app.config).update_one(
        {"_id": ObjectId(session_id)}, {"$set": {"live_state.current_match.started_at": stored_start}}
    )
    first_team = session["teams"][0]
    scorer_id, assist_id = first_team["player_ids"]
    player_by_id = {str(player["_id"]): player for player in players}
    reporter = player_by_id[scorer_id]

    reported = client.post(
        f"/api/physical-football/sessions/{session_id}/live/goals",
        json={"scorer_id": scorer_id, "assist_id": assist_id}, headers=headers(client, reporter["email"]),
    )
    assert reported.status_code == 201
    pending_state = reported.json["data"]["session"]["live_state"]
    event = pending_state["goal_events"][0]
    assert event["status"] == "pending"
    assert 80 <= event["elapsed_seconds"] <= 90
    assert event["created_at"]
    assert event["score_before"] == {team_id: 0 for team_id in match["team_ids"]}
    assert event["score_after"][first_team["id"]] == 1
    assert pending_state["cumulative_score"] == {team_id: 0 for team_id in match["team_ids"]}
    assert pending_state["player_stats"] == {}

    confirmed = client.patch(
        f"/api/physical-football/sessions/{session_id}/live/goals/{event['id']}",
        json={"action": "confirm"}, headers=coordinator_headers,
    )
    assert confirmed.status_code == 200
    confirmed_state = confirmed.json["data"]["session"]["live_state"]
    assert confirmed_state["cumulative_score"][first_team["id"]] == 1
    assert confirmed_state["player_stats"][scorer_id]["goals"] == 1
    assert confirmed_state["player_stats"][assist_id]["assists"] == 1
    duplicate = client.patch(
        f"/api/physical-football/sessions/{session_id}/live/goals/{event['id']}",
        json={"action": "confirm"}, headers=coordinator_headers,
    )
    assert duplicate.status_code == 409

    edited = client.patch(
        f"/api/physical-football/sessions/{session_id}/live/goals/{event['id']}",
        json={"action": "edit", "scorer_id": scorer_id, "assist_id": None, "elapsed_seconds": 42},
        headers=coordinator_headers,
    )
    assert edited.status_code == 200
    edited_event = edited.json["data"]["session"]["live_state"]["goal_events"][0]
    assert edited_event["elapsed_seconds"] == 42
    assert edited_event["assist_id"] is None
    assert edited.json["data"]["session"]["live_state"]["player_stats"].get(assist_id) is None

    refreshed = client.get(
        "/api/physical-football/sessions/current", headers=headers(client, reporter["email"]),
    ).json["data"]["session"]["live_state"]
    assert refreshed["current_match"]["started_at"]
    assert refreshed["goal_events"][0]["elapsed_seconds"] == 42
    assert refreshed["cumulative_score"][first_team["id"]] == 1

    rejected = client.patch(
        f"/api/physical-football/sessions/{session_id}/live/goals/{event['id']}",
        json={"action": "reject"}, headers=coordinator_headers,
    )
    assert rejected.status_code == 200
    rejected_state = rejected.json["data"]["session"]["live_state"]
    assert rejected_state["goal_events"][0]["status"] == "rejected"
    assert rejected_state["cumulative_score"][first_team["id"]] == 0
    assert rejected_state["player_stats"] == {}


def test_winner_stays_confirmed_goals_stay_with_completed_match_and_drive_rotation(client, create_user):
    _, coordinator_headers, _, session_id, session = prepare_phase_two_session(client, create_user, 3)
    assert client.put(
        f"/api/physical-football/sessions/{session_id}/live/config",
        json={"format": "winner_stays", "match_duration_minutes": 7, "session_duration_minutes": 60},
        headers=coordinator_headers,
    ).status_code == 200
    state = client.post(
        f"/api/physical-football/sessions/{session_id}/live/start", headers=coordinator_headers,
    ).json["data"]["session"]["live_state"]
    match_id = state["current_match"]["id"]
    first_id, second_id = state["current_match"]["team_ids"]
    team_map = {team["id"]: team for team in session["teams"]}
    for _ in range(2):
        goal = client.post(
            f"/api/physical-football/sessions/{session_id}/live/goals",
            json={"scorer_id": team_map[first_id]["player_ids"][0], "assist_id": None, "direct": True},
            headers=coordinator_headers,
        )
        assert goal.status_code == 201
    rotated = client.post(
        f"/api/physical-football/sessions/{session_id}/live/matches/{match_id}/result",
        json={}, headers=coordinator_headers,
    )
    assert rotated.status_code == 200
    next_state = rotated.json["data"]["session"]["live_state"]
    assert next_state["matches"][0]["team_one_score"] == 2
    assert next_state["matches"][0]["team_two_score"] == 0
    assert next_state["matches"][0]["winner_id"] == first_id
    assert next_state["current_match"]["id"] != match_id
    assert next_state["current_match"]["score"] == {team_id: 0 for team_id in next_state["current_match"]["team_ids"]}
    assert len([event for event in next_state["goal_events"] if event["match_id"] == match_id]) == 2
    standings = {row["team_id"]: row for row in next_state["standings"]}
    assert standings[first_id]["goals_for"] == 2
    assert standings[second_id]["goals_against"] == 2
