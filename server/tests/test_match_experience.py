from datetime import datetime, timezone


def _login(client, email):
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "correct-horse-battery-staple"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def _schedule(client, headers, opponent_id):
    response = client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(opponent_id)},
    )
    assert response.status_code == 201, response.json
    return response.json["data"]


def _submit_result(client, headers, match_id, player_one_score=2, player_two_score=1):
    return client.post(
        f"/api/matches/{match_id}/submit-result",
        headers=headers,
        json={
            "player_one_score": player_one_score,
            "player_two_score": player_two_score,
            "proof_image_url": None,
        },
    )


def test_match_views_follow_authoritative_responsibility_and_complete_journey(
    client, create_user, users, activity_logs
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    users.update_one(
        {"_id": alpha["_id"]},
        {"$set": {"profile_image": "data:image/png;base64,iVBORw0KGgo="}},
    )
    alpha_headers = _login(client, "alpha@example.com")
    beta_headers = _login(client, "beta@example.com")

    match = _schedule(client, alpha_headers, beta["_id"])
    match_id = match["id"]

    incoming = client.get(
        "/api/matches/my?view=attention&page=1&limit=20",
        headers=beta_headers,
    )
    assert incoming.status_code == 200
    assert [item["id"] for item in incoming.json["data"]["matches"]] == [match_id]
    assert incoming.json["data"]["view_counts"]["attention"] == 1

    outgoing = client.get(
        "/api/matches/my?view=awaiting_opponent&page=1&limit=20",
        headers=alpha_headers,
    )
    assert [item["id"] for item in outgoing.json["data"]["matches"]] == [match_id]

    accepted = client.post(f"/api/matches/{match_id}/accept", headers=beta_headers)
    assert accepted.status_code == 200
    assert accepted.json["data"]["status"] == "pending_result"
    assert client.post(f"/api/matches/{match_id}/accept", headers=beta_headers).status_code == 200
    assert activity_logs.count_documents(
        {
            "action_type": "match_request_accepted",
            "details.match_id": match_id,
        }
    ) == 1

    active = client.get(
        "/api/matches/my?view=active&page=1&limit=20",
        headers=alpha_headers,
    )
    active_match = active.json["data"]["matches"][0]
    assert active_match["can_submit_result"] is True
    assert active_match["opponent"]["username"] == "Beta"

    submitted = _submit_result(client, alpha_headers, match_id)
    assert submitted.status_code == 200
    assert submitted.json["data"]["status"] == "pending_confirmation"

    awaiting = client.get(
        "/api/matches/my?view=attention&page=1&limit=20",
        headers=beta_headers,
    )
    assert awaiting.json["data"]["matches"][0]["can_confirm"] is True
    waiting_on_opponent = client.get(
        "/api/matches/my?view=awaiting_opponent&page=1&limit=20",
        headers=alpha_headers,
    )
    assert waiting_on_opponent.json["data"]["matches"][0]["id"] == match_id

    confirmed = client.post(f"/api/matches/{match_id}/confirm", headers=beta_headers)
    assert confirmed.status_code == 200
    assert confirmed.json["data"]["status"] == "confirmed"
    assert client.post(f"/api/matches/{match_id}/confirm", headers=beta_headers).status_code == 400

    completed = client.get(
        "/api/matches/my?view=completed&page=1&limit=20",
        headers=alpha_headers,
    ).json["data"]["matches"][0]
    assert completed["id"] == match_id
    assert completed["result"] == "win"
    assert completed["player_one_score"] == 2
    assert completed["player_two_score"] == 1
    assert completed["player_one"]["profile_image"].startswith("data:image/png")
    assert "_id" not in completed
    assert "password_hash" not in completed
    assert "email" not in completed


def test_match_eligibility_self_challenge_duplicates_and_view_validation(
    client, create_user
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    disabled = create_user("disabled@example.com", username="Disabled", status="disabled")
    admin = create_user("admin@example.com", username="Admin", role="admin")
    headers = _login(client, "alpha@example.com")

    assert client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(alpha["_id"])},
    ).status_code == 400
    assert client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(disabled["_id"])},
    ).status_code == 422
    assert client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(admin["_id"])},
    ).status_code == 422

    _schedule(client, headers, beta["_id"])
    duplicate = client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(beta["_id"])},
    )
    assert duplicate.status_code == 409
    assert client.get(
        "/api/matches/my?view=unsupported&page=1&limit=20",
        headers=headers,
    ).status_code == 422


def test_decline_cancel_and_dispute_workflows_reject_duplicate_actions(
    client, create_user
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    alpha_headers = _login(client, "alpha@example.com")
    beta_headers = _login(client, "beta@example.com")

    declined = _schedule(client, alpha_headers, beta["_id"])
    declined_id = declined["id"]
    decline_payload = {"reason": "unavailable", "note": "Schedule conflict"}
    assert client.post(
        f"/api/matches/{declined_id}/decline",
        headers=beta_headers,
        json=decline_payload,
    ).status_code == 200
    assert client.post(
        f"/api/matches/{declined_id}/decline",
        headers=beta_headers,
        json=decline_payload,
    ).status_code == 400

    cancelled = _schedule(client, alpha_headers, beta["_id"])
    cancelled_id = cancelled["id"]
    assert client.post(f"/api/matches/{cancelled_id}/cancel", headers=alpha_headers).status_code == 200
    assert client.post(f"/api/matches/{cancelled_id}/cancel", headers=alpha_headers).status_code == 400

    disputed = _schedule(client, alpha_headers, beta["_id"])
    disputed_id = disputed["id"]
    assert client.post(f"/api/matches/{disputed_id}/accept", headers=beta_headers).status_code == 200
    assert _submit_result(client, alpha_headers, disputed_id).status_code == 200
    opened = client.post(
        f"/api/matches/{disputed_id}/dispute",
        headers=beta_headers,
        json={"dispute_note": "The submitted score does not match the proof."},
    )
    assert opened.status_code == 200
    assert opened.json["data"]["status"] == "disputed"
    assert client.post(
        f"/api/matches/{disputed_id}/dispute",
        headers=beta_headers,
        json={"dispute_note": "Duplicate"},
    ).status_code == 400
    disputed_view = client.get(
        "/api/matches/my?view=disputed&page=1&limit=20",
        headers=alpha_headers,
    )
    assert disputed_view.json["data"]["matches"][0]["dispute_note"]


def test_scores_and_match_detail_enforce_validation_ownership_and_missing_states(
    client, create_user
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    outsider = create_user("outsider@example.com", username="Outsider")
    alpha_headers = _login(client, "alpha@example.com")
    beta_headers = _login(client, "beta@example.com")
    outsider_headers = _login(client, "outsider@example.com")
    match_id = _schedule(client, alpha_headers, beta["_id"])["id"]
    client.post(f"/api/matches/{match_id}/accept", headers=beta_headers)

    assert _submit_result(client, alpha_headers, match_id, -1, 2).status_code == 400
    assert _submit_result(client, alpha_headers, match_id, 1.5, 2).status_code == 400

    detail = client.get(f"/api/matches/{match_id}", headers=alpha_headers)
    assert detail.status_code == 200
    assert detail.json["data"]["id"] == match_id
    assert detail.json["data"]["status"] == "pending_result"
    assert client.get(f"/api/matches/{match_id}", headers=outsider_headers).status_code == 403
    assert client.get("/api/matches/not-an-id", headers=alpha_headers).status_code == 400
    assert client.get(
        "/api/matches/000000000000000000000000",
        headers=alpha_headers,
    ).status_code == 404


def test_match_list_pagination_is_bounded_and_reports_metadata(
    client, create_user, matches
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    headers = _login(client, "alpha@example.com")
    now = datetime.now(timezone.utc)
    for index in range(23):
        matches.insert_one(
            {
                "player_one_id": str(alpha["_id"]),
                "player_two_id": str(beta["_id"]),
                "player_one_name": "Alpha",
                "player_two_name": "Beta",
                "created_by": str(alpha["_id"]),
                "requested_to": str(beta["_id"]),
                "status": "confirmed",
                "player_one_score": index,
                "player_two_score": 0,
                "winner_id": str(alpha["_id"]),
                "created_at": now,
                "confirmed_at": now,
                "updated_at": now,
            }
        )

    response = client.get(
        "/api/matches/my?view=completed&page=2&limit=10",
        headers=headers,
    )
    assert response.status_code == 200
    data = response.json["data"]
    assert len(data["matches"]) == 10
    assert data["page"] == 2
    assert data["limit"] == 10
    assert data["total"] == 23
    assert data["pages"] == 3
    assert data["has_next"] is True
    assert data["has_previous"] is True
    assert client.get(
        "/api/matches/my?view=completed&page=1&limit=101",
        headers=headers,
    ).status_code == 422
