from werkzeug.security import check_password_hash

from app import db as db_module
from seed_physical_football_players import (
    TEST_ACCOUNT_GROUP,
    TEST_PASSWORD,
    TEST_PLAYERS,
    cleanup_test_players,
    create_test_players,
    require_safe_environment,
)


def test_seed_is_idempotent_login_ready_and_cleanup_is_scoped(app):
    first = create_test_players(app.config)
    second = create_test_players(app.config)
    assert len(first) == len(second) == 5

    users = db_module.get_users_collection(config=app.config)
    seeded = list(users.find({"test_account_group": TEST_ACCOUNT_GROUP}))
    assert len(seeded) == 5
    assert all(item["role"] == "player" and item["is_active"] for item in seeded)
    assert all(check_password_hash(item["password_hash"], TEST_PASSWORD) for item in seeded)

    real_user_id = users.insert_one({
        "username": "real-player",
        "email": "real-player@example.com",
        "role": "player",
        "status": "active",
        "is_active": True,
    }).inserted_id
    session_id = db_module.get_physical_football_sessions_collection(config=app.config).insert_one({
        "module": "physical_football",
        "session_date": "2099-01-04",
        "selected_player_ids": [str(seeded[0]["_id"]), str(real_user_id)],
        "draft_teams": [{"id": "one", "name": "Team 1", "player_ids": [str(seeded[0]["_id"]), str(real_user_id)]}],
        "confirmed_teams": [],
    }).inserted_id
    db_module.get_physical_football_availability_collection(config=app.config).insert_one({
        "session_id": str(session_id), "player_id": str(seeded[0]["_id"]), "status": "available"
    })

    assert cleanup_test_players(app.config) == 5
    assert users.find_one({"_id": real_user_id}) is not None
    cleaned_session = db_module.get_physical_football_sessions_collection(config=app.config).find_one({"_id": session_id})
    assert cleaned_session["selected_player_ids"] == [str(real_user_id)]
    assert cleaned_session["draft_teams"][0]["player_ids"] == [str(real_user_id)]
    assert db_module.get_physical_football_availability_collection(config=app.config).count_documents({}) == 0


def test_seed_refuses_production_and_unmarked_conflicts(app):
    production_config = {**app.config, "APP_ENV": "production", "IS_PRODUCTION": True}
    try:
        require_safe_environment(production_config)
        assert False, "production guard should fail"
    except RuntimeError:
        pass

    identity = TEST_PLAYERS[0]
    db_module.get_users_collection(config=app.config).insert_one({
        "username": identity["username"],
        "email": "unrelated@example.com",
        "role": "player",
    })
    try:
        create_test_players(app.config)
        assert False, "unmarked username conflict should fail"
    except RuntimeError:
        pass
