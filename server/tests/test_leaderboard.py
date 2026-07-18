from datetime import datetime, timezone

from app.services.competitive_service import (
    build_leaderboard,
    build_public_player_profile,
)


def _match(submitter, opponent, *, winner=None, status="confirmed"):
    return {
        "submitted_by": str(submitter["_id"]),
        "opponent_id": str(opponent["_id"]),
        "winner_id": str(winner["_id"]) if winner else None,
        "status": status,
        "confirmed_at": datetime.now(timezone.utc),
    }


def test_authoritative_order_ignores_ineligible_players_and_unconfirmed_matches(
    create_user, matches, users
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    gamma = create_user("gamma@example.com", username="Gamma")
    create_user("disabled@example.com", username="Disabled", status="disabled")

    matches.insert_many(
        [
            _match(beta, alpha, winner=beta),
            _match(alpha, gamma, winner=alpha),
            _match(gamma, alpha, winner=gamma, status="pending_confirmation"),
            _match(gamma, beta, winner=gamma, status="disputed"),
        ]
    )

    leaderboard = build_leaderboard(users, matches)
    assert [entry["username"] for entry in leaderboard] == ["Alpha", "Beta", "Gamma"]
    assert [entry["rank"] for entry in leaderboard] == [1, 2, 3]
    assert leaderboard[0]["points"] == leaderboard[1]["points"] == 3
    assert leaderboard[0]["wins"] == leaderboard[1]["wins"] == 1
    assert leaderboard[2]["total_matches"] == 1
    assert all("email" not in entry and "password_hash" not in entry for entry in leaderboard)


def test_leaderboard_pagination_search_and_current_player_keep_absolute_rank(
    client, create_user
):
    players = [
        create_user(f"player{index:02d}@example.com", username=f"Player {index:02d}")
        for index in range(25)
    ]

    page_two = client.get("/api/leaderboard?page=2&limit=5")
    assert page_two.status_code == 200
    page_data = page_two.json["data"]
    assert [entry["rank"] for entry in page_data["leaderboard"]] == [6, 7, 8, 9, 10]
    assert page_data["page"] == 2
    assert page_data["limit"] == 5
    assert page_data["total"] == 25
    assert page_data["pages"] == 5
    assert page_data["has_next"] is True
    assert page_data["has_previous"] is True

    search = client.get(
        f"/api/leaderboard?page=1&limit=5&search=%20Player%20%2007%20"
        f"&player_id={players[-1]['_id']}"
    )
    assert search.status_code == 200
    search_data = search.json["data"]
    assert [(entry["username"], entry["rank"]) for entry in search_data["leaderboard"]] == [
        ("Player 07", 8)
    ]
    assert search_data["current_player"]["id"] == str(players[-1]["_id"])
    assert search_data["current_player"]["rank"] == 25
    assert [entry["rank"] for entry in search_data["nearby_players"]] == [24, 25]
    assert search_data["ranked_total"] == 25
    assert len(search_data["top_players"]) == 3


def test_leaderboard_validation_avatar_delivery_and_profile_consistency(
    client, create_user, matches, users
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")
    matches.insert_one(_match(alpha, beta, winner=alpha))

    image_value = "data:image/png;base64,iVBORw0KGgo="
    users.update_one(
        {"_id": alpha["_id"]},
        {"$set": {"profile_image": image_value, "updated_at": datetime.now(timezone.utc)}},
    )

    response = client.get(f"/api/leaderboard?player_id={alpha['_id']}&limit=1")
    assert response.status_code == 200
    data = response.json["data"]
    alpha_entry = data["current_player"]
    assert alpha_entry["profile_image"] == image_value
    assert alpha_entry["points"] == 3
    assert alpha_entry["wins"] == 1
    assert alpha_entry["total_matches"] == 1

    public_profile = build_public_player_profile(str(alpha["_id"]), users, matches)
    for field in ("rank", "points", "wins", "losses", "draws", "total_matches", "win_rate"):
        assert public_profile[field] == alpha_entry[field]

    assert client.get("/api/leaderboard?season=2026").status_code == 422
    assert client.get("/api/leaderboard?page=0").status_code == 422
    assert client.get(f"/api/leaderboard?search={'x' * 65}").status_code == 422
    assert client.get("/api/leaderboard?player_id=not-an-id").status_code == 400


def test_confirmed_match_changes_ranking_once_and_duplicate_confirmation_is_rejected(
    client, create_user
):
    alpha = create_user("alpha@example.com", username="Alpha")
    beta = create_user("beta@example.com", username="Beta")

    def login(email):
        response = client.post(
            "/api/auth/login",
            json={"email": email, "password": "correct-horse-battery-staple"},
        )
        assert response.status_code == 200
        return {"Authorization": f"Bearer {response.json['access_token']}"}

    alpha_headers = login("alpha@example.com")
    beta_headers = login("beta@example.com")
    scheduled = client.post(
        "/api/matches/schedule",
        headers=alpha_headers,
        json={"opponent_id": str(beta["_id"])},
    )
    match_id = scheduled.json["data"]["id"]
    assert client.post(f"/api/matches/{match_id}/accept", headers=beta_headers).status_code == 200
    submitted = client.post(
        f"/api/matches/{match_id}/submit-result",
        headers=alpha_headers,
        json={
            "player_one_score": 2,
            "player_two_score": 0,
            "winner_id": str(alpha["_id"]),
            "proof_image_url": None,
        },
    )
    assert submitted.status_code == 200
    assert client.post(f"/api/matches/{match_id}/confirm", headers=beta_headers).status_code == 200
    duplicate_confirmation = client.post(
        f"/api/matches/{match_id}/confirm",
        headers=beta_headers,
    )
    assert duplicate_confirmation.status_code in {400, 409}

    leaderboard = client.get(f"/api/leaderboard?player_id={alpha['_id']}").json["data"]
    assert leaderboard["current_player"]["points"] == 3
    assert leaderboard["current_player"]["wins"] == 1
    assert leaderboard["current_player"]["total_matches"] == 1
