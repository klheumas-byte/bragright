from datetime import datetime, timezone


PASSWORD = "correct-horse-battery-staple"
FORBIDDEN_RESPONSE_FIELDS = {
    "password",
    "temporary_password",
    "new_password",
    "password_hash",
    "refresh_token",
    "token_hash",
    "jwt_access_secret",
    "secret_key",
    "is_admin",
    "permissions",
    "last_login",
    "last_login_at",
    "last_login_user_agent",
    "device_info",
    "ip_address",
    "debug",
    "database",
    "mongo_uri",
    "mongo_db_name",
}


def _login(client, email):
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": PASSWORD},
    )
    assert response.status_code == 200
    return response.json["access_token"]


def _bearer(token):
    return {"Authorization": f"Bearer {token}"}


def _assert_no_sensitive_fields(value):
    if isinstance(value, dict):
        assert not (set(value) & FORBIDDEN_RESPONSE_FIELDS)
        for nested_value in value.values():
            _assert_no_sensitive_fields(nested_value)
    elif isinstance(value, list):
        for nested_value in value:
            _assert_no_sensitive_fields(nested_value)


def test_player_cannot_edit_another_player(
    client,
    create_user,
    users,
):
    player = create_user("player@example.com", password=PASSWORD)
    other = create_user(
        "other@example.com",
        password=PASSWORD,
        username="other-player",
    )
    access_token = _login(client, "player@example.com")

    response = client.patch(
        "/api/profile/me",
        json={
            "user_id": str(other["_id"]),
            "username": "hijacked-name",
        },
        headers=_bearer(access_token),
    )

    assert response.status_code == 422
    assert users.find_one({"_id": other["_id"]})["username"] == "other-player"
    assert users.find_one({"_id": player["_id"]})["username"] != "hijacked-name"


def test_player_cannot_delete_another_players_upload(
    client,
    create_user,
    proof_uploads,
):
    owner = create_user("owner@example.com", password=PASSWORD)
    create_user("attacker@example.com", password=PASSWORD)
    filename = "a" * 32 + ".png"
    proof_uploads.insert_one(
        {
            "filename": filename,
            "owner_id": str(owner["_id"]),
            "match_id": None,
            "created_at": datetime.now(timezone.utc),
        }
    )
    attacker_token = _login(client, "attacker@example.com")

    response = client.delete(
        f"/api/matches/proof/{filename}",
        headers=_bearer(attacker_token),
    )

    assert response.status_code == 403
    assert proof_uploads.find_one({"filename": filename}) is not None


def test_player_cannot_submit_result_for_another_players_match(
    client,
    create_user,
    matches,
):
    player_one = create_user("one@example.com", password=PASSWORD)
    player_two = create_user("two@example.com", password=PASSWORD)
    create_user("outsider@example.com", password=PASSWORD)
    now = datetime.now(timezone.utc)
    match_id = matches.insert_one(
        {
            "player_one_id": str(player_one["_id"]),
            "player_two_id": str(player_two["_id"]),
            "player_one_name": "one",
            "player_two_name": "two",
            "status": "pending_result",
            "created_at": now,
            "updated_at": now,
        }
    ).inserted_id
    outsider_token = _login(client, "outsider@example.com")

    response = client.post(
        f"/api/matches/{match_id}/submit-result",
        json={
            "player_one_score": 2,
            "player_two_score": 1,
            "winner_id": str(player_one["_id"]),
        },
        headers=_bearer(outsider_token),
    )

    assert response.status_code == 403
    assert matches.find_one({"_id": match_id})["status"] == "pending_result"


def test_hidden_development_endpoints_are_inaccessible(client):
    for path in ("/api", "/api/test-db", "/test-db"):
        response = client.get(path)
        assert response.status_code == 404
        assert response.json["error"]["code"] == "NOT_FOUND"


def test_sensitive_fields_never_appear_in_user_responses(
    app,
    client,
    create_user,
    users,
):
    player = create_user("player@example.com", password=PASSWORD)
    users.update_one(
        {"_id": player["_id"]},
        {
            "$set": {
                "last_login_user_agent": "secret-agent",
                "permissions": ["internal"],
                "token_hash": "secret-token-hash",
            }
        },
    )
    access_token = _login(client, "player@example.com")

    responses = [
        client.get("/api/auth/me", headers=_bearer(access_token)),
        client.get("/api/profile/me", headers=_bearer(access_token)),
        client.get("/api/players"),
    ]
    for response in responses:
        assert response.status_code == 200
        _assert_no_sensitive_fields(response.json)


def test_profile_owner_can_update_own_profile(client, create_user, users):
    player = create_user("player@example.com", password=PASSWORD)
    access_token = _login(client, "player@example.com")

    response = client.patch(
        "/api/profile/me",
        json={"username": "updated-player", "image": ""},
        headers=_bearer(access_token),
    )

    assert response.status_code == 200
    assert users.find_one({"_id": player["_id"]})["username"] == "updated-player"


def test_profile_rejects_unsupported_avatar_data_type(client, create_user, users):
    player = create_user("player@example.com", password=PASSWORD)
    access_token = _login(client, "player@example.com")

    response = client.patch(
        "/api/profile/me",
        json={
            "username": "player",
            "image": "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
        },
        headers=_bearer(access_token),
    )

    assert response.status_code == 400
    response_message = response.json.get("message") or response.json.get("error", {}).get("message", "")
    assert "PNG, JPEG, or WebP" in response_message
    assert users.find_one({"_id": player["_id"]})["profile_image"] is None


def test_profile_rejects_invalid_avatar_base64(client, create_user):
    create_user("player@example.com", password=PASSWORD)
    access_token = _login(client, "player@example.com")

    response = client.patch(
        "/api/profile/me",
        json={
            "username": "player",
            "image": "data:image/png;base64,not-valid-***",
        },
        headers=_bearer(access_token),
    )

    assert response.status_code == 400
    response_message = response.json.get("message") or response.json.get("error", {}).get("message", "")
    assert "not valid base64" in response_message


def test_profile_accepts_supported_avatar_signature(client, create_user, users):
    player = create_user("player@example.com", password=PASSWORD)
    access_token = _login(client, "player@example.com")
    image = "data:image/png;base64,iVBORw0KGgo="

    response = client.patch(
        "/api/profile/me",
        json={"username": "player", "image": image},
        headers=_bearer(access_token),
    )

    assert response.status_code == 200
    assert users.find_one({"_id": player["_id"]})["profile_image"] == image


def test_public_profile_returns_supported_identity_fields_without_private_data(
    client,
    create_user,
    users,
):
    player = create_user(
        "public-player@example.com",
        password=PASSWORD,
        username="public-player",
    )
    users.update_one(
        {"_id": player["_id"]},
        {"$set": {"profile_image": "data:image/png;base64,cHJvZmlsZQ=="}},
    )

    response = client.get(f"/api/players/{player['_id']}")

    assert response.status_code == 200
    assert response.json["data"]["profile_image"].startswith("data:image/png")
    assert response.json["data"]["created_at"]
    assert response.json["data"]["status"] == "active"
    assert "email" not in response.json["data"]


def test_security_headers_are_applied(client):
    response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert "default-src 'none'" in response.headers["Content-Security-Policy"]


def test_admin_password_values_are_never_returned(client, create_user):
    create_user(
        "admin@example.com",
        password=PASSWORD,
        role="admin",
        username="admin-user",
    )
    admin_token = _login(client, "admin@example.com")

    response = client.post(
        "/api/admin/users",
        json={
            "username": "new-player",
            "email": "new-player@example.com",
            "role": "player",
            "temporary_password": "temporary-password-123",
        },
        headers=_bearer(admin_token),
    )

    assert response.status_code == 201
    _assert_no_sensitive_fields(response.json)


def test_malformed_pagination_is_rejected(client, create_user):
    create_user("player@example.com", password=PASSWORD)
    access_token = _login(client, "player@example.com")

    response = client.get(
        "/api/matches/my?limit=not-a-number",
        headers=_bearer(access_token),
    )

    assert response.status_code == 422
    assert response.json["error"]["code"] == "VALIDATION_ERROR"
