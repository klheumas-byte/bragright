import gzip


def test_sensitive_auth_route_returns_429_with_retry_after(app, client):
    app.config["RATE_LIMIT_AUTH"] = 1

    first = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "not-the-password"},
    )
    second = client.post(
        "/api/auth/login",
        json={"email": "missing@example.com", "password": "not-the-password"},
    )

    assert first.status_code == 401
    assert second.status_code == 429
    assert second.json["error"]["code"] == "TOO_MANY_REQUESTS"
    assert int(second.headers["Retry-After"]) >= 1


def test_public_player_directory_is_paginated(client, create_user):
    create_user("charlie@example.com", username="Charlie")
    create_user("alpha@example.com", username="Alpha")
    create_user("bravo@example.com", username="Bravo")

    response = client.get("/api/players?page=2&limit=2")

    assert response.status_code == 200
    assert response.json["data"]["page"] == 2
    assert response.json["data"]["limit"] == 2
    assert response.json["data"]["total"] == 3
    assert response.json["data"]["pages"] == 2
    assert [player["username"] for player in response.json["data"]["players"]] == [
        "Charlie"
    ]


def test_large_public_json_response_supports_gzip(app, client, create_user):
    app.config["RESPONSE_COMPRESSION_MIN_BYTES"] = 256
    for index in range(12):
        create_user(
            f"player-{index}@example.com",
            username=f"Player {index:02d} with a longer display name",
        )

    response = client.get(
        "/api/players?limit=100",
        headers={"Accept-Encoding": "gzip"},
    )

    assert response.status_code == 200
    assert response.headers["Content-Encoding"] == "gzip"
    assert "Accept-Encoding" in response.headers["Vary"]
    assert b'"players"' in gzip.decompress(response.data)
    assert response.headers["Cache-Control"].startswith("public")


def test_private_api_response_is_never_publicly_cached(
    client, create_user
):
    create_user("player@example.com")
    login = client.post(
        "/api/auth/login",
        json={
            "email": "player@example.com",
            "password": "correct-horse-battery-staple",
        },
    )
    response = client.get(
        "/api/profile/me",
        headers={"Authorization": f"Bearer {login.json['access_token']}"},
    )

    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"


def test_player_release_candidate_journey(client, create_user):
    player_one = create_user("one@example.com", username="Player One")
    player_two = create_user("two@example.com", username="Player Two")

    def login(email):
        response = client.post(
            "/api/auth/login",
            json={
                "email": email,
                "password": "correct-horse-battery-staple",
            },
        )
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json['access_token']}"}

    player_one_headers = login("one@example.com")
    player_two_headers = login("two@example.com")

    assert client.get(
        "/api/profile/me", headers=player_one_headers
    ).status_code == 200

    scheduled = client.post(
        "/api/matches/schedule",
        headers=player_one_headers,
        json={"opponent_id": str(player_two["_id"])},
    )
    assert scheduled.status_code == 201
    match_id = scheduled.json["data"]["id"]

    accepted = client.post(
        f"/api/matches/{match_id}/accept",
        headers=player_two_headers,
    )
    assert accepted.status_code == 200

    submitted = client.post(
        f"/api/matches/{match_id}/submit-result",
        headers=player_one_headers,
        json={
            "player_one_score": 3,
            "player_two_score": 1,
            "winner_id": str(player_one["_id"]),
            "proof_image_url": None,
        },
    )
    assert submitted.status_code == 200, submitted.json

    confirmed = client.post(
        f"/api/matches/{match_id}/confirm",
        headers=player_two_headers,
    )
    assert confirmed.status_code == 200
    assert confirmed.json["data"]["status"] == "confirmed"

    leaderboard = client.get("/api/leaderboard")
    assert leaderboard.status_code == 200
    assert leaderboard.json["data"]["total"] == 2
    assert client.get(
        "/api/dashboard/notifications", headers=player_one_headers
    ).status_code == 200
    assert client.post(
        "/api/auth/logout", headers=player_one_headers
    ).status_code == 200


def test_admin_release_candidate_read_journey(client, create_user):
    create_user("admin@example.com", username="Admin", role="admin")
    login = client.post(
        "/api/auth/login",
        json={
            "email": "admin@example.com",
            "password": "correct-horse-battery-staple",
        },
    )
    headers = {"Authorization": f"Bearer {login.json['access_token']}"}

    for path in (
        "/api/admin/dashboard/summary",
        "/api/admin/users",
        "/api/admin/disputes",
        "/api/admin/matches",
        "/api/admin/settings",
        "/api/admin/activity",
    ):
        assert client.get(path, headers=headers).status_code == 200
