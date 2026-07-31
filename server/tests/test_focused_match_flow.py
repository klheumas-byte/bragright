from datetime import datetime, timedelta, timezone


PASSWORD = "correct-horse-battery-staple"


def login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def schedule(client, headers, opponent_id, **details):
    response = client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(opponent_id), **details},
    )
    assert response.status_code == 201, response.json
    return response.json["data"]


def test_request_metadata_redirect_foundation_and_focused_notification_link(
    client, create_user
):
    alpha = create_user("focus-alpha@example.com", username="Alpha")
    beta = create_user("focus-beta@example.com", username="Beta")
    alpha_headers = login(client, "focus-alpha@example.com")
    beta_headers = login(client, "focus-beta@example.com")
    match = schedule(
        client,
        alpha_headers,
        beta["_id"],
        game="EA Sports FC",
        match_type="Competitive Match",
        scheduled_at="2026-07-25T18:30:00Z",
        request_message="Best of luck",
    )
    assert match["game"] == "EA Sports FC"
    assert match["request_message"] == "Best of luck"
    assert match["status_message"] == "Awaiting Beta's response"

    actions = client.get("/api/dashboard/actions", headers=beta_headers).json["data"]
    request = next(item for item in actions["items"] if item["type"] == "match_request")
    assert request["action_url"] == f"/matches/{match['id']}/respond"


def test_acceptance_revalidates_expiry_and_marks_stale_request_expired(
    client, create_user, matches
):
    alpha = create_user("expiry-alpha@example.com", username="Alpha")
    beta = create_user("expiry-beta@example.com", username="Beta")
    alpha_headers = login(client, "expiry-alpha@example.com")
    beta_headers = login(client, "expiry-beta@example.com")
    match = schedule(client, alpha_headers, beta["_id"])
    matches.update_one(
        {"_id": __import__("bson").ObjectId(match["id"])},
        {
            "$set": {
                "request_expires_at": (
                    datetime.now(timezone.utc) - timedelta(seconds=1)
                ).replace(tzinfo=None)
            }
        },
    )
    response = client.post(f"/api/matches/{match['id']}/accept", headers=beta_headers)
    assert response.status_code == 409
    assert matches.find_one({"_id": __import__("bson").ObjectId(match["id"])})["status"] == "expired"


def test_acceptance_handles_naive_mongodb_expiry_and_advances_to_result(
    client, create_user, matches
):
    alpha = create_user("naive-alpha@example.com", username="Alpha")
    beta = create_user("naive-beta@example.com", username="Beta")
    alpha_headers = login(client, "naive-alpha@example.com")
    beta_headers = login(client, "naive-beta@example.com")
    match = schedule(client, alpha_headers, beta["_id"])
    matches.update_one(
        {"_id": __import__("bson").ObjectId(match["id"])},
        {
            "$set": {
                "request_expires_at": (
                    datetime.now(timezone.utc) + timedelta(days=1)
                ).replace(tzinfo=None)
            }
        },
    )

    response = client.post(f"/api/matches/{match['id']}/accept", headers=beta_headers)

    assert response.status_code == 200
    assert response.json["data"]["status"] == "pending_result"
    assert response.json["data"]["can_submit_result"] is True
    stored = matches.find_one({"_id": __import__("bson").ObjectId(match["id"])})
    assert stored["status"] == "pending_result"
    assert stored["accepted_by"] == str(beta["_id"])
    assert stored["accepted_at"] is not None


def test_decline_requires_reason_and_preserves_actor_and_note(
    client, create_user
):
    alpha = create_user("decline-alpha@example.com", username="Alpha")
    beta = create_user("decline-beta@example.com", username="Beta")
    alpha_headers = login(client, "decline-alpha@example.com")
    beta_headers = login(client, "decline-beta@example.com")
    match = schedule(client, alpha_headers, beta["_id"])
    assert client.post(f"/api/matches/{match['id']}/decline", headers=beta_headers, json={}).status_code == 422
    response = client.post(
        f"/api/matches/{match['id']}/decline",
        headers=beta_headers,
        json={"reason": "unavailable", "note": "Travel conflict"},
    )
    assert response.status_code == 200
    declined = response.json["data"]
    assert declined["declined_by"] == str(beta["_id"])
    assert declined["decline_reason"] == "unavailable"
    assert declined["decline_note"] == "Travel conflict"
    assert declined["status_message"] == "Beta declined the match request"


def test_server_calculates_result_and_confirmation_detail_exposes_exact_score(
    client, create_user
):
    alpha = create_user("result-alpha@example.com", username="Alpha")
    beta = create_user("result-beta@example.com", username="Beta")
    alpha_headers = login(client, "result-alpha@example.com")
    beta_headers = login(client, "result-beta@example.com")
    match = schedule(client, alpha_headers, beta["_id"])
    assert client.post(f"/api/matches/{match['id']}/accept", headers=beta_headers).status_code == 200
    submitted = client.post(
        f"/api/matches/{match['id']}/submit-result",
        headers=alpha_headers,
        json={
            "player_one_score": 3,
            "player_two_score": 1,
            "played_at": "2026-07-23T10:00:00Z",
            "proof_image_url": None,
        },
    )
    assert submitted.status_code == 200
    assert submitted.json["data"]["winner_id"] == str(alpha["_id"])
    detail = client.get(f"/api/matches/{match['id']}", headers=beta_headers).json["data"]
    assert (detail["player_one_score"], detail["player_two_score"]) == (3, 1)
    assert detail["can_confirm"] is True
    actions = client.get("/api/dashboard/actions", headers=beta_headers).json["data"]
    confirmation = next(item for item in actions["items"] if item["type"] == "result_awaiting_confirmation")
    assert confirmation["action_url"] == f"/matches/{match['id']}/result/confirm"
