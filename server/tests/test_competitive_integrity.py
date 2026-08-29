from datetime import datetime, timedelta, timezone

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
