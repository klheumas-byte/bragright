from datetime import datetime, timezone


def _login(client, email):
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "correct-horse-battery-staple"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def test_player_activity_is_owner_only_paginated_and_safely_projected(
    client, create_user, activity_logs
):
    owner = create_user("owner@example.com", username="Owner")
    other = create_user("other@example.com", username="Other")
    owner_headers = _login(client, "owner@example.com")
    _login(client, "other@example.com")

    activity_logs.insert_one(
        {
            "user_id": str(owner["_id"]),
            "username": "Owner",
            "role": "player",
            "action_type": "profile_updated",
            "action_label": "INTERNAL_PROFILE_CODE",
            "details": {
                "next_username": "Owner Two",
                "email": "owner@example.com",
                "ip_address": "192.0.2.1",
                "private_note": "never return this",
            },
            "created_at": datetime.now(timezone.utc),
        }
    )
    activity_logs.insert_one(
        {
            "user_id": str(owner["_id"]),
            "username": "Owner",
            "role": "admin",
            "action_type": "admin_password_reset",
            "action_label": "Private historical admin action",
            "details": {"target_email": "private@example.com"},
            "created_at": datetime.now(timezone.utc),
        }
    )

    response = client.get(
        "/api/activity/me?page=1&limit=1&category=profile",
        headers=owner_headers,
    )
    assert response.status_code == 200
    assert response.json["data"]["limit"] == 1
    assert response.json["data"]["total"] == 1
    log = response.json["data"]["logs"][0]
    assert log["actor"]["display_name"] == "Owner"
    assert log["details"] == {"next_username": "Owner Two"}
    assert "user_id" not in log
    assert "action_label" not in log
    assert "summary" not in log
    assert "email" not in str(log)
    assert str(other["_id"]) not in str(response.json)
    unfiltered = client.get("/api/activity/me", headers=owner_headers)
    assert "admin_password_reset" not in str(unfiltered.json)
    assert "private@example.com" not in str(unfiltered.json)


def test_activity_filters_validate_and_admin_boundary_remains_protected(
    client, create_user
):
    create_user("player@example.com", username="Player")
    create_user("admin@example.com", username="Admin", role="admin")
    player_headers = _login(client, "player@example.com")
    admin_headers = _login(client, "admin@example.com")

    invalid = client.get("/api/activity/me?category=private_admin", headers=player_headers)
    assert invalid.status_code == 422
    assert client.get("/api/admin/activity", headers=player_headers).status_code == 403
    admin_response = client.get("/api/admin/activity?page=1&limit=10", headers=admin_headers)
    assert admin_response.status_code == 200
    assert admin_response.json["data"]["logs"]


def test_deleted_related_record_and_missing_actor_are_safe(
    client, create_user, activity_logs
):
    owner = create_user("owner@example.com", username="Owner")
    headers = _login(client, "owner@example.com")
    activity_logs.insert_one(
        {
            "user_id": str(owner["_id"]),
            "username": "Former player",
            "role": "player",
            "action_type": "match_confirmed",
            "action_label": "Match confirmed",
            "details": {"match_id": "507f1f77bcf86cd799439011"},
            "created_at": datetime.now(timezone.utc),
        }
    )

    response = client.get("/api/activity/me?category=results", headers=headers)
    assert response.status_code == 200
    log = response.json["data"]["logs"][0]
    assert log["related"] == {"kind": "match", "available": False}
    assert log["actor"]["display_name"] == "Owner"


def test_match_activity_contains_safe_opponent_and_valid_direct_link(
    client, create_user, users
):
    owner = create_user("owner@example.com", username="Owner")
    opponent = create_user("opponent@example.com", username="Opponent")
    users.update_one(
        {"_id": opponent["_id"]},
        {"$set": {"profile_image": "data:image/png;base64,iVBORw0KGgo="}},
    )
    headers = _login(client, "owner@example.com")
    scheduled = client.post(
        "/api/matches/schedule",
        headers=headers,
        json={"opponent_id": str(opponent["_id"])},
    )
    assert scheduled.status_code == 201
    match_id = scheduled.json["data"]["id"]

    response = client.get("/api/activity/me?category=challenges", headers=headers)
    log = response.json["data"]["logs"][0]
    assert log["related"]["opponent"]["display_name"] == "Opponent"
    assert log["related"]["opponent"]["profile_image"].startswith("data:image/png")
    assert log["related"]["path"] == f"/dashboard/matches?matchId={match_id}"
    assert "opponent_id" not in str(log)


def test_one_time_match_activity_event_key_is_idempotent(app, activity_logs, create_user):
    from app.services.activity_logger import record_activity

    player = create_user("player@example.com", username="Player")
    user = {"id": str(player["_id"]), "username": "Player", "role": "player"}
    details = {"match_id": "507f1f77bcf86cd799439011"}
    with app.test_request_context("/"):
        record_activity(user=user, action_type="match_confirmed", action_label="Match confirmed", details=details)
        record_activity(user=user, action_type="match_confirmed", action_label="Match confirmed", details=details)
    assert activity_logs.count_documents({"event_key": "match_confirmed:507f1f77bcf86cd799439011"}) == 1


def test_activity_ordering_uses_id_as_a_stable_tiebreaker(
    client, create_user, activity_logs
):
    owner = create_user("owner@example.com", username="Owner")
    headers = _login(client, "owner@example.com")
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    inserted = []
    for index in range(3):
        result = activity_logs.insert_one(
            {
                "user_id": str(owner["_id"]),
                "username": "Owner",
                "role": "player",
                "action_type": "profile_updated",
                "action_label": f"Update {index}",
                "details": {},
                "created_at": timestamp,
            }
        )
        inserted.append(str(result.inserted_id))
    response = client.get("/api/activity/me?category=profile", headers=headers)
    returned = [item["id"] for item in response.json["data"]["logs"]]
    assert returned == list(reversed(inserted))
