"""Create or remove the fixed local Physical Football test players."""

import argparse
import re
import sys
from datetime import datetime, timezone

from werkzeug.security import generate_password_hash

from app import create_app
from app.db import (
    get_activity_logs_collection,
    get_auth_sessions_collection,
    get_login_activity_collection,
    get_notifications_collection,
    get_physical_football_availability_collection,
    get_physical_football_sessions_collection,
    get_subscription_exemptions_collection,
    get_subscriptions_collection,
    get_users_collection,
)
from app.services.subscription_service import current_billing_month, recalculate_subscription


TEST_ACCOUNT_GROUP = "physical_football_local_test_players"
TEST_PASSWORD = "Test1234!"
TEST_PLAYERS = tuple(
    {
        "username": f"testplayer{index}",
        "email": f"testplayer{index}@bragright.test",
    }
    for index in range(1, 6)
)
SAFE_ENVIRONMENTS = {"development", "testing", "test", "local"}


def require_safe_environment(config):
    environment = str(config.get("APP_ENV") or "").strip().lower()
    if config.get("IS_PRODUCTION") or environment not in SAFE_ENVIRONMENTS:
        raise RuntimeError(
            "Physical Football test players can only be managed in development/testing environments."
        )


def _existing_test_accounts(config):
    emails = [item["email"] for item in TEST_PLAYERS]
    return list(get_users_collection(config=config).find({"email": {"$in": emails}}))


def create_test_players(config):
    require_safe_environment(config)
    users = get_users_collection(config=config)

    conflicts = []
    for identity in TEST_PLAYERS:
        existing = users.find_one({
            "$or": [
                {"email": identity["email"]},
                {"username": re.compile(f"^{re.escape(identity['username'])}$", re.IGNORECASE)},
            ]
        })
        if existing and (
            existing.get("is_test_account") is not True
            or existing.get("test_account_group") != TEST_ACCOUNT_GROUP
            or existing.get("email") != identity["email"]
        ):
            conflicts.append(identity["username"])
    if conflicts:
        raise RuntimeError(
            "Refusing to modify existing unmarked accounts: " + ", ".join(conflicts)
        )

    now = datetime.now(timezone.utc)
    month = current_billing_month(now)
    exemptions = get_subscription_exemptions_collection(config=config)
    created = []
    for identity in TEST_PLAYERS:
        user = users.find_one({"email": identity["email"]})
        values = {
            "username": identity["username"],
            "email": identity["email"],
            "password_hash": generate_password_hash(TEST_PASSWORD),
            "role": "player",
            "status": "active",
            "is_active": True,
            "must_change_password": False,
            "profile_image": None,
            "is_test_account": True,
            "test_account_group": TEST_ACCOUNT_GROUP,
            "updated_at": now,
        }
        if user:
            users.update_one({"_id": user["_id"]}, {"$set": values})
            user_id = user["_id"]
        else:
            values.update({"created_at": now, "last_login": None, "last_login_at": None})
            user_id = users.insert_one(values).inserted_id

        player_id = str(user_id)
        exemptions.update_one(
            {"player_id": player_id, "billing_month": month},
            {
                "$set": {
                    "status": "active",
                    "reason": "Local Physical Football test account",
                    "note": TEST_ACCOUNT_GROUP,
                    "is_test_data": True,
                    "updated_at": now,
                },
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        recalculate_subscription(config, player_id, month, now=now)
        created.append({**identity, "id": player_id})
    return created


def _without_test_players(teams, player_ids):
    return [
        {**team, "player_ids": [value for value in team.get("player_ids", []) if value not in player_ids]}
        for team in teams or []
    ]


def cleanup_test_players(config):
    require_safe_environment(config)
    users = get_users_collection(config=config)
    accounts = _existing_test_accounts(config)
    removable = [
        item for item in accounts
        if item.get("is_test_account") is True
        and item.get("test_account_group") == TEST_ACCOUNT_GROUP
    ]
    player_ids = {str(item["_id"]) for item in removable}
    if not player_ids:
        return 0

    get_physical_football_availability_collection(config=config).delete_many(
        {"player_id": {"$in": list(player_ids)}}
    )
    sessions = get_physical_football_sessions_collection(config=config)
    for session in sessions.find({
        "$or": [
            {"selected_player_ids": {"$in": list(player_ids)}},
            {"draft_teams.player_ids": {"$in": list(player_ids)}},
            {"confirmed_teams.player_ids": {"$in": list(player_ids)}},
        ]
    }):
        sessions.update_one(
            {"_id": session["_id"]},
            {"$set": {
                "selected_player_ids": [
                    value for value in session.get("selected_player_ids", []) if value not in player_ids
                ],
                "draft_teams": _without_test_players(session.get("draft_teams"), player_ids),
                "confirmed_teams": _without_test_players(session.get("confirmed_teams"), player_ids),
                "updated_at": datetime.now(timezone.utc),
            }},
        )

    player_id_query = {"player_id": {"$in": list(player_ids)}}
    get_subscriptions_collection(config=config).delete_many(player_id_query)
    get_subscription_exemptions_collection(config=config).delete_many(player_id_query)
    get_auth_sessions_collection(config=config).delete_many({"user_id": {"$in": list(player_ids)}})
    get_login_activity_collection(config=config).delete_many({"user_id": {"$in": list(player_ids)}})
    get_activity_logs_collection(config=config).delete_many({"user_id": {"$in": list(player_ids)}})
    get_notifications_collection(config=config).delete_many({"user_id": {"$in": list(player_ids)}})
    result = users.delete_many({
        "_id": {"$in": [item["_id"] for item in removable]},
        "is_test_account": True,
        "test_account_group": TEST_ACCOUNT_GROUP,
    })
    return result.deleted_count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("create", "cleanup"))
    args = parser.parse_args()
    app = create_app()
    try:
        with app.app_context():
            if args.action == "create":
                accounts = create_test_players(app.config)
                print(f"Ready: {len(accounts)} Physical Football test players.")
                for account in accounts:
                    print(f"{account['username']} ({account['email']})")
            else:
                print(f"Deleted: {cleanup_test_players(app.config)} Physical Football test players.")
        return 0
    except RuntimeError as error:
        print(f"Safety error: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
