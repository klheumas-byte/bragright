from datetime import datetime, timedelta, timezone

from bson import ObjectId

from app.services.competitive_service import build_leaderboard
from app.services.leaderboard_reign_service import reconstruct_reigns, reign_summary
from app.services.statistics_service import build_player_statistics


def _match(identifier, one, two, score, winner, at, **extra):
    return {"_id": identifier, "status": "confirmed", "player_one_id": one, "player_two_id": two,
            "submitted_by": one, "opponent_id": two, "player_one_score": score[0], "player_two_score": score[1],
            "winner_id": winner, "confirmed_at": at, **extra}


def _login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery-staple"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def test_forfeit_preserves_actual_score_but_uses_competitive_outcome_and_four_points(users, matches, create_user):
    alpha = create_user("integrity-a@example.com", username="Alpha")
    beta = create_user("integrity-b@example.com", username="Beta")
    match = _match("forfeit", str(alpha["_id"]), str(beta["_id"]), (2, 2), str(alpha["_id"]), datetime.now(timezone.utc), result_type="forfeit", quit_by=str(beta["_id"]))
    matches.insert_one(match)
    stats = build_player_statistics(str(alpha["_id"]), [match])
    assert (stats["goals_scored"], stats["goals_conceded"], stats["wins"]) == (2, 2, 1)
    board = build_leaderboard(users, matches)
    alpha_entry = next(item for item in board if item["id"] == str(alpha["_id"]))
    beta_entry = next(item for item in board if item["id"] == str(beta["_id"]))
    assert (alpha_entry["points"], beta_entry["points"]) == (4, 0)


def test_reigns_are_reconstructed_only_from_authoritative_chronological_results():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    users = [{"_id": "a", "username": "Alpha", "role": "player"}, {"_id": "b", "username": "Beta", "role": "player"}]
    matches = [_match("1", "a", "b", (1, 0), "a", now), _match("2", "a", "b", (0, 1), "b", now + timedelta(days=2), result_type="forfeit")]
    reigns = reconstruct_reigns(users, matches, now=now + timedelta(days=5))
    assert [item["player_id"] for item in reigns] == ["a", "b"]
    assert reigns[0]["ended_at"] == now + timedelta(days=2)
    summary = reign_summary(reigns, now=now + timedelta(days=5))
    assert summary["current"]["player_id"] == "b"
    assert summary["total_seconds_by_player"]["a"] == 2 * 24 * 60 * 60


def test_reigns_normalize_naive_datetimes_returned_by_production_pymongo():
    confirmed_at = datetime(2026, 1, 1)
    now = datetime(2026, 1, 3, tzinfo=timezone.utc)
    users = [{"_id": "a", "username": "Alpha", "role": "player"}, {"_id": "b", "username": "Beta", "role": "player"}]
    reigns = reconstruct_reigns([*users], [_match("naive", "a", "b", (1, 0), "a", confirmed_at)], now=now)
    assert reigns[0]["started_at"].tzinfo == timezone.utc
    assert reigns[0]["duration_seconds"] == 2 * 24 * 60 * 60
    assert reign_summary(reigns, now=now)["current"]["player_id"] == "a"


def test_admin_can_reject_disputed_result(client, create_user):
    alpha = create_user("reject-a@example.com", username="Alpha")
    beta = create_user("reject-b@example.com", username="Beta")
    admin = create_user("reject-admin@example.com", username="Admin", role="admin")
    a_headers, b_headers, admin_headers = _login(client, alpha["email"]), _login(client, beta["email"]), _login(client, admin["email"])
    created = client.post("/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])}).json["data"]
    match_id = created["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200
    assert client.post(f"/api/matches/{match_id}/submit-result", headers=a_headers, json={"player_one_score": 1, "player_two_score": 0}).status_code == 200
    assert client.post(f"/api/matches/{match_id}/dispute", headers=b_headers, json={"dispute_note": "Not correct"}).status_code == 200
    response = client.patch(f"/api/admin/matches/{match_id}/resolve", headers=admin_headers, json={"resolution_action": "reject_result", "resolution_note": "Evidence does not support the claim."})
    assert response.status_code == 200, response.json
    assert response.json["data"]["status"] == "rejected"


def test_completed_admin_resolution_is_not_reported_failed_when_reign_refresh_fails(client, create_user, monkeypatch):
    from app.services import leaderboard_reign_service

    alpha = create_user("refresh-a@example.com", username="Alpha")
    beta = create_user("refresh-b@example.com", username="Beta")
    admin = create_user("refresh-admin@example.com", username="Admin", role="admin")
    a_headers, b_headers, admin_headers = _login(client, alpha["email"]), _login(client, beta["email"]), _login(client, admin["email"])
    match_id = client.post("/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])}).json["data"]["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200
    assert client.post(f"/api/matches/{match_id}/submit-result", headers=a_headers, json={"player_one_score": 2, "player_two_score": 1}).status_code == 200
    assert client.post(f"/api/matches/{match_id}/dispute", headers=b_headers, json={"dispute_note": "Review this"}).status_code == 200

    def fail_refresh(*args, **kwargs):
        raise RuntimeError("simulated derived-history failure")

    monkeypatch.setattr(leaderboard_reign_service, "refresh_reigns", fail_refresh)
    response = client.patch(f"/api/admin/matches/{match_id}/resolve", headers=admin_headers, json={"resolution_action": "confirm_result", "resolution_note": "Submitted result is supported."})
    assert response.status_code == 200, response.json
    assert response.json["data"]["status"] == "confirmed"


def test_admin_dispute_resolution_survives_all_post_commit_hook_failures(
    client, create_user, monkeypatch
):
    from app.routes import admin as admin_routes

    alpha = create_user("hooks-a@example.com", username="Alpha")
    beta = create_user("hooks-b@example.com", username="Beta")
    admin = create_user("hooks-admin@example.com", username="Admin", role="admin")
    a_headers = _login(client, alpha["email"])
    b_headers = _login(client, beta["email"])
    admin_headers = _login(client, admin["email"])
    match_id = client.post(
        "/api/matches/schedule",
        headers=a_headers,
        json={"opponent_id": str(beta["_id"])},
    ).json["data"]["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200
    assert client.post(
        f"/api/matches/{match_id}/submit-result",
        headers=a_headers,
        json={"player_one_score": 3, "player_two_score": 2},
    ).status_code == 200
    assert client.post(
        f"/api/matches/{match_id}/dispute",
        headers=b_headers,
        json={"dispute_note": "Check the submitted evidence."},
    ).status_code == 200

    def fail_hook(*args, **kwargs):
        raise RuntimeError("simulated post-commit dependency failure")

    monkeypatch.setattr(admin_routes, "refresh_reigns_after_mutation", fail_hook)
    monkeypatch.setattr(admin_routes, "record_activity", fail_hook)
    monkeypatch.setattr(admin_routes, "_load_user_names", fail_hook)
    response = client.patch(
        f"/api/admin/matches/{match_id}/resolve",
        headers=admin_headers,
        json={
            "resolution_action": "confirm_result",
            "resolution_note": "The evidence confirms the submitted result.",
        },
    )

    assert response.status_code == 200, response.json
    assert response.json["success"] is True
    assert response.json["data"]["status"] == "confirmed"
    assert response.json["data"]["player_one_id"] == str(alpha["_id"])
    assert response.json["data"]["player_two_id"] == str(beta["_id"])


def test_duplicate_admin_dispute_resolution_returns_conflict_without_overwrite(
    client, create_user, matches
):
    alpha = create_user("stale-a@example.com", username="Alpha")
    beta = create_user("stale-b@example.com", username="Beta")
    admin = create_user("stale-admin@example.com", username="Admin", role="admin")
    a_headers = _login(client, alpha["email"])
    b_headers = _login(client, beta["email"])
    admin_headers = _login(client, admin["email"])
    match_id = client.post(
        "/api/matches/schedule",
        headers=a_headers,
        json={"opponent_id": str(beta["_id"])},
    ).json["data"]["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200
    assert client.post(
        f"/api/matches/{match_id}/submit-result",
        headers=a_headers,
        json={"player_one_score": 1, "player_two_score": 0},
    ).status_code == 200
    assert client.post(
        f"/api/matches/{match_id}/dispute",
        headers=b_headers,
        json={"dispute_note": "This result needs review."},
    ).status_code == 200

    first = client.patch(
        f"/api/admin/matches/{match_id}/resolve",
        headers=admin_headers,
        json={
            "resolution_action": "confirm_result",
            "resolution_note": "First authoritative decision.",
        },
    )
    second = client.patch(
        f"/api/admin/matches/{match_id}/resolve",
        headers=admin_headers,
        json={
            "resolution_action": "reject_result",
            "resolution_note": "A stale second decision.",
        },
    )

    assert first.status_code == 200, first.json
    assert second.status_code == 409, second.json
    assert second.json["error"]["code"] == "STALE_MATCH_ACTION"
    stored = matches.find_one({"_id": ObjectId(match_id)})
    assert stored["status"] == "confirmed"
    assert stored["resolution_note"] == "First authoritative decision."
    assert sum(
        item.get("event") == "admin_dispute_resolution"
        for item in stored.get("result_history", [])
    ) == 1


def test_restart_requires_opponent_agreement_and_creates_clean_replacement(client, create_user):
    alpha = create_user("restart-a@example.com", username="Alpha")
    beta = create_user("restart-b@example.com", username="Beta")
    a_headers, b_headers = _login(client, alpha["email"]), _login(client, beta["email"])
    created = client.post("/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])}).json["data"]
    match_id = created["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200

    requested = client.post(f"/api/matches/{match_id}/restart", headers=a_headers, json={"action": "request", "reason": "Connection dropped"})
    assert requested.status_code == 200, requested.json
    requester_view = client.get(f"/api/matches/{match_id}", headers=a_headers).json["data"]
    responder_view = client.get(f"/api/matches/{match_id}", headers=b_headers).json["data"]
    assert requester_view["restart_requested_by_current_user"] is True
    assert requester_view["can_request_restart"] is False
    assert responder_view["can_respond_restart"] is True
    assert responder_view["restart_reason"] == "Connection dropped"

    forbidden = client.post(f"/api/matches/{match_id}/restart", headers=a_headers, json={"action": "agree"})
    assert forbidden.status_code == 403
    agreed = client.post(f"/api/matches/{match_id}/restart", headers=b_headers, json={"action": "agree"})
    assert agreed.status_code == 201, agreed.json
    replacement = agreed.json["data"]
    assert replacement["status"] == "match_requested"
    assert replacement["restart_of"] == match_id
    assert replacement["player_one_score"] is None
    assert replacement["player_two_score"] is None
    original = client.get(f"/api/matches/{match_id}", headers=a_headers).json["data"]
    assert original["status"] == "cancelled"
    assert original["result_type"] == "abandoned"


def test_forfeit_endpoint_keeps_score_and_assigns_four_zero_points(client, create_user):
    alpha = create_user("quit-a@example.com", username="Alpha")
    beta = create_user("quit-b@example.com", username="Beta")
    a_headers, b_headers = _login(client, alpha["email"]), _login(client, beta["email"])
    match_id = client.post("/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])}).json["data"]["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200
    response = client.post(f"/api/matches/{match_id}/forfeit", headers=a_headers, json={"player_one_score": 3, "player_two_score": 1, "confirmed": True})
    assert response.status_code == 200, response.json
    result = response.json["data"]
    assert (result["player_one_score"], result["player_two_score"]) == (3, 1)
    assert result["winner_id"] == str(beta["_id"])
    assert result["ranking_points"] == {str(alpha["_id"]): 0, str(beta["_id"]): 4}


def test_leaderboard_reign_endpoint_returns_named_verified_history(client, users, matches, create_user):
    alpha = create_user("reign-a@example.com", username="Alpha")
    beta = create_user("reign-b@example.com", username="Beta")
    now = datetime.now(timezone.utc) - timedelta(days=2)
    matches.insert_one(_match("reign-one", str(alpha["_id"]), str(beta["_id"]), (1, 0), str(alpha["_id"]), now))
    response = client.get("/api/leaderboard/reigns")
    assert response.status_code == 200, response.json
    data = response.json["data"]
    assert data["current"]["player"]["username"] == "Alpha"
    assert data["reigns"][0]["player"]["id"] == str(alpha["_id"])
    assert data["reigns"][0]["duration_seconds"] >= 2 * 24 * 60 * 60
