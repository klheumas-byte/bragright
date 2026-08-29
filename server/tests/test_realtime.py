from datetime import date, datetime, timedelta, timezone

from app.services.subscription_service import current_billing_month


def _login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": "correct-horse-battery-staple"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def test_challenge_events_are_cursor_based_and_isolated_to_affected_players(client, create_user):
    alpha = create_user("live-a@example.com", username="Alpha")
    beta = create_user("live-b@example.com", username="Beta")
    create_user("live-c@example.com", username="Charlie")
    a_headers = _login(client, alpha["email"])
    b_headers = _login(client, beta["email"])
    c_headers = _login(client, "live-c@example.com")
    b_cursor = client.get("/api/realtime/events", headers=b_headers).json["data"]["cursor"]
    c_cursor = client.get("/api/realtime/events", headers=c_headers).json["data"]["cursor"]
    created = client.post("/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])})
    assert created.status_code == 201, created.json
    beta_events = client.get(f"/api/realtime/events?after={b_cursor}", headers=b_headers).json["data"]["events"]
    charlie_events = client.get(f"/api/realtime/events?after={c_cursor}", headers=c_headers).json["data"]["events"]
    assert [event["type"] for event in beta_events] == ["challenge.created", "notification.created"]
    assert charlie_events == []
    assert set(beta_events[0]["resource"]) <= {"id", "status"}


def test_acceptance_and_result_events_follow_authoritative_transitions(client, create_user):
    alpha = create_user("flow-a@example.com", username="Alpha")
    beta = create_user("flow-b@example.com", username="Beta")
    a_headers, b_headers = _login(client, alpha["email"]), _login(client, beta["email"])
    created = client.post("/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])}).json["data"]
    cursor = client.get("/api/realtime/events", headers=a_headers).json["data"]["cursor"]
    assert client.post(f"/api/matches/{created['id']}/accept", headers=b_headers).status_code == 200
    accepted = client.get(f"/api/realtime/events?after={cursor}", headers=a_headers).json["data"]
    assert [event["type"] for event in accepted["events"]] == ["challenge.accepted", "notification.updated", "match.updated"]
    cursor = accepted["cursor"]
    assert client.post(f"/api/matches/{created['id']}/submit-result", headers=a_headers, json={"player_one_score": 2, "player_two_score": 1}).status_code == 200
    events = client.get(f"/api/realtime/events?after={cursor}", headers=b_headers).json["data"]["events"]
    assert [event["type"] for event in events] == ["match.result_submitted", "notification.updated", "match.updated"]


def test_realtime_feed_requires_authentication(client):
    assert client.get("/api/realtime/events").status_code == 401


def test_dispute_resolution_notifies_players_and_invalidates_leaderboard(client, create_user):
    alpha = create_user("resolve-a@example.com", username="Alpha")
    beta = create_user("resolve-b@example.com", username="Beta")
    admin = create_user("resolve-admin@example.com", role="admin")
    a_headers = _login(client, alpha["email"])
    b_headers = _login(client, beta["email"])
    admin_headers = _login(client, admin["email"])
    match_id = client.post(
        "/api/matches/schedule", headers=a_headers, json={"opponent_id": str(beta["_id"])}
    ).json["data"]["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=b_headers).status_code == 200
    assert client.post(
        f"/api/matches/{match_id}/submit-result",
        headers=a_headers,
        json={"player_one_score": 2, "player_two_score": 1},
    ).status_code == 200
    assert client.post(
        f"/api/matches/{match_id}/dispute",
        headers=b_headers,
        json={"dispute_note": "Please review this result."},
    ).status_code == 200
    cursor = client.get("/api/realtime/events", headers=a_headers).json["data"]["cursor"]

    resolved = client.patch(
        f"/api/admin/matches/{match_id}/resolve",
        headers=admin_headers,
        json={
            "resolution_action": "confirm_result",
            "resolution_note": "The submitted evidence supports the score.",
        },
    )
    assert resolved.status_code == 200, resolved.json
    events = client.get(f"/api/realtime/events?after={cursor}", headers=a_headers).json["data"]["events"]
    assert [event["type"] for event in events] == [
        "match.resolved", "notification.updated", "match.updated", "leaderboard.updated"
    ]


def test_recorded_payment_emits_activation_for_affected_player(client, create_user):
    player = create_user("live-payment@example.com", subscription_access=False)
    officer = create_user("live-officer@example.com", role="payment_officer")
    player_headers = _login(client, player["email"])
    officer_headers = _login(client, officer["email"])
    cursor = client.get("/api/realtime/events", headers=player_headers).json["data"]["cursor"]
    month = current_billing_month()

    response = client.post(
        "/api/payments/payments",
        headers=officer_headers,
        json={
            "player_id": str(player["_id"]),
            "billing_month": month,
            "amount": "20.00",
            "payment_method": "mobile_money",
            "payment_date": datetime.now(timezone.utc).date().isoformat(),
            "reference": "LIVE-SYNC-PAYMENT-001",
            "note": "Realtime synchronization test",
        },
    )
    assert response.status_code == 201, response.json
    events = client.get(f"/api/realtime/events?after={cursor}", headers=player_headers).json["data"]["events"]
    assert [event["type"] for event in events] == [
        "payment.recorded", "subscription.activated", "notification.updated"
    ]


def test_physical_football_mutation_is_visible_to_authorized_players(client, create_user):
    admin = create_user("live-football-admin@example.com", role="admin")
    player = create_user("live-football-player@example.com")
    admin_headers = _login(client, admin["email"])
    player_headers = _login(client, player["email"])
    cursor = client.get("/api/realtime/events", headers=player_headers).json["data"]["cursor"]
    today = date.today()
    sunday = today + timedelta(days=(6 - today.weekday()) % 7)

    response = client.post(
        "/api/physical-football/sessions",
        headers=admin_headers,
        json={
            "date": sunday.isoformat(),
            "location": "Community Park",
            "start_time": "16:30",
            "end_time": "18:30",
            "availability_cutoff": f"{(sunday - timedelta(days=1)).isoformat()}T18:00:00+00:00",
        },
    )
    assert response.status_code == 201, response.json
    events = client.get(f"/api/realtime/events?after={cursor}", headers=player_headers).json["data"]["events"]
    assert [event["type"] for event in events] == ["physical_football.updated"]
