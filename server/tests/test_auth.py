from datetime import timedelta
from http.cookies import SimpleCookie

from app.services.auth_tokens import create_access_token


PLAYER_EMAIL = "player@example.com"
PLAYER_PASSWORD = "correct-horse-battery-staple"


def _login(client, email=PLAYER_EMAIL, password=PLAYER_PASSWORD):
    return client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )


def _bearer(access_token):
    return {"Authorization": f"Bearer {access_token}"}


def _cookie_value(response, cookie_name="bragright_refresh"):
    for header in response.headers.getlist("Set-Cookie"):
        cookie = SimpleCookie()
        cookie.load(header)
        if cookie_name in cookie:
            return cookie[cookie_name].value
    return None


def test_successful_player_login_returns_safe_session(client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)

    response = _login(client)

    assert response.status_code == 200
    assert response.json["success"] is True
    assert response.json["access_token"]
    assert response.json["user"]["role"] == "player"
    assert "password_hash" not in response.json["user"]
    assert "refresh_token" not in response.json
    assert _cookie_value(response)
    assert "HttpOnly" in response.headers.get("Set-Cookie")


def test_production_refresh_cookie_supports_partitioned_cross_site_sessions(
    app, client, create_user
):
    app.config.update(
        AUTH_COOKIE_SECURE=True,
        AUTH_COOKIE_SAMESITE="None",
        AUTH_COOKIE_PARTITIONED=True,
    )
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)

    response = _login(client)
    cookie_header = response.headers.get("Set-Cookie")

    assert response.status_code == 200
    assert "Secure" in cookie_header
    assert "SameSite=None" in cookie_header
    assert "Partitioned" in cookie_header


def test_invalid_password_is_rejected(client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)

    response = _login(client, password="wrong-password")

    assert response.status_code == 401
    assert response.json["error"]["message"] == "Invalid email or password."


def test_disabled_account_login_is_rejected(client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD, status="disabled")

    response = _login(client)

    assert response.status_code == 423
    assert response.json["error"]["code"] == "ACCOUNT_DISABLED"


def test_protected_route_without_token_is_rejected(client):
    response = client.get("/api/dashboard/summary")

    assert response.status_code == 401
    assert response.json["error"]["code"] == "MISSING_ACCESS_TOKEN"


def test_protected_route_with_invalid_token_is_rejected(client):
    response = client.get(
        "/api/dashboard/summary",
        headers=_bearer("not-a-valid-jwt"),
    )

    assert response.status_code == 401
    assert response.json["error"]["code"] == "INVALID_TOKEN"


def test_protected_route_with_expired_token_is_rejected(
    app,
    client,
    create_user,
    sessions,
):
    user = create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    login_response = _login(client)
    active_session = sessions.find_one({"user_id": str(user["_id"]), "revoked_at": None})
    with app.app_context():
        expired_token = create_access_token(
            str(user["_id"]),
            active_session["session_id"],
            lifetime=timedelta(seconds=-1),
        )

    response = client.get(
        "/api/dashboard/summary",
        headers=_bearer(expired_token),
    )

    assert login_response.status_code == 200
    assert response.status_code == 401
    assert response.json["error"]["code"] == "TOKEN_EXPIRED"


def test_valid_refresh_rotates_session(client, create_user, sessions):
    user = create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    login_response = _login(client)
    original_cookie = _cookie_value(login_response)
    original_session = sessions.find_one(
        {"user_id": str(user["_id"]), "revoked_at": None}
    )

    response = client.post("/api/auth/refresh")

    assert response.status_code == 200
    assert response.json["access_token"]
    assert _cookie_value(response) != original_cookie
    rotated_session = sessions.find_one({"session_id": original_session["session_id"]})
    assert rotated_session["revoked_at"] is not None
    assert rotated_session["replaced_by"]
    assert sessions.find_one(
        {"session_id": rotated_session["replaced_by"], "revoked_at": None}
    )


def test_rotated_refresh_token_cannot_be_reused(app, client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    login_response = _login(client)
    original_cookie = _cookie_value(login_response)
    assert client.post("/api/auth/refresh").status_code == 200

    replay_client = app.test_client()
    replay_client.set_cookie("bragright_refresh", original_cookie)
    response = replay_client.post("/api/auth/refresh")

    assert response.status_code == 401
    assert response.json["error"]["code"] == "REFRESH_TOKEN_REUSED"


def test_untrusted_browser_origin_cannot_refresh(client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert _login(client).status_code == 200

    response = client.post(
        "/api/auth/refresh",
        headers={"Origin": "https://attacker.example"},
    )

    assert response.status_code == 403
    assert response.json["error"]["code"] == "UNTRUSTED_ORIGIN"


def test_logout_revokes_refresh_and_access_session(client, create_user, sessions):
    user = create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    login_response = _login(client)
    access_token = login_response.json["access_token"]

    logout_response = client.post(
        "/api/auth/logout",
        headers=_bearer(access_token),
    )
    me_response = client.get("/api/auth/me", headers=_bearer(access_token))

    assert logout_response.status_code == 200
    assert me_response.status_code == 401
    assert sessions.count_documents(
        {"user_id": str(user["_id"]), "revoked_at": None}
    ) == 0


def test_player_cannot_access_admin_endpoint(client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD, role="player")
    access_token = _login(client).json["access_token"]

    response = client.get("/api/admin/users", headers=_bearer(access_token))

    assert response.status_code == 403


def test_admin_can_access_admin_endpoint(client, create_user):
    create_user(
        "admin@example.com",
        password=PLAYER_PASSWORD,
        role="admin",
        username="admin-user",
    )
    access_token = _login(client, email="admin@example.com").json["access_token"]

    response = client.get("/api/admin/users", headers=_bearer(access_token))

    assert response.status_code == 200
    assert response.json["success"] is True


def test_x_user_id_header_does_not_authenticate(client, create_user):
    user = create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)

    response = client.get(
        "/api/dashboard/summary",
        headers={"X-User-Id": str(user["_id"])},
    )

    assert response.status_code == 401
    assert response.json["error"]["code"] == "MISSING_ACCESS_TOKEN"


def test_forged_client_role_has_no_backend_effect(client, create_user):
    create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD, role="player")
    access_token = _login(client).json["access_token"]

    response = client.get(
        "/api/admin/users",
        headers={
            **_bearer(access_token),
            "X-User-Role": "admin",
            "X-User-Is-Admin": "true",
        },
    )

    assert response.status_code == 403


def test_refresh_fails_after_account_is_disabled(client, create_user, users, sessions):
    user = create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    assert _login(client).status_code == 200
    users.update_one(
        {"_id": user["_id"]},
        {"$set": {"status": "disabled", "is_active": False}},
    )

    response = client.post("/api/auth/refresh")

    assert response.status_code == 423
    assert response.json["error"]["code"] == "ACCOUNT_DISABLED"
    assert sessions.count_documents(
        {"user_id": str(user["_id"]), "revoked_at": None}
    ) == 0


def test_admin_disabling_account_revokes_existing_sessions(app, create_user):
    player = create_user(PLAYER_EMAIL, password=PLAYER_PASSWORD)
    create_user(
        "admin@example.com",
        password=PLAYER_PASSWORD,
        role="admin",
        username="admin-user",
    )
    player_client = app.test_client()
    admin_client = app.test_client()
    player_access_token = _login(player_client).json["access_token"]
    admin_access_token = _login(
        admin_client,
        email="admin@example.com",
    ).json["access_token"]

    disable_response = admin_client.patch(
        f"/api/admin/users/{player['_id']}/status",
        json={"status": "disabled"},
        headers=_bearer(admin_access_token),
    )
    protected_response = player_client.get(
        "/api/auth/me",
        headers=_bearer(player_access_token),
    )

    assert disable_response.status_code == 200
    assert protected_response.status_code == 401
    assert protected_response.json["error"]["code"] == "SESSION_REVOKED"


def test_registration_cannot_create_admin_through_email_or_payload(client, users):
    response = client.post(
        "/api/auth/register",
        json={
            "username": "bootstrap",
            "email": "bootstrap@example.com",
            "password": PLAYER_PASSWORD,
            "role": "admin",
            "is_admin": True,
        },
    )

    created_user = users.find_one({"email": "bootstrap@example.com"})
    assert response.status_code == 422
    assert response.json["error"]["code"] == "VALIDATION_ERROR"
    assert created_user is None
