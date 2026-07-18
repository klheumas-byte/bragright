import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.errors import ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError
from werkzeug.security import generate_password_hash

from app.db import describe_mongo_error, get_mongo_settings, load_server_env


ADMIN_ROLE = "admin"
ADMIN_STATUS = "active"


def main():
    load_server_env()
    admin_email = str(os.getenv("ADMIN_SEED_EMAIL", "")).strip().lower()
    admin_username = str(os.getenv("ADMIN_SEED_USERNAME", "")).strip()
    admin_password = str(os.getenv("ADMIN_SEED_PASSWORD", ""))
    if not admin_email or not admin_username or len(admin_password) < 12:
        print(
            "Configuration error: ADMIN_SEED_EMAIL, ADMIN_SEED_USERNAME, and an "
            "ADMIN_SEED_PASSWORD of at least 12 characters are required."
        )
        return 1

    try:
        settings = get_mongo_settings()
    except RuntimeError as exc:
        print(f"Configuration error: {exc}")
        return 1

    print("This script will create or update the admin account below:")
    print(f"Email: {admin_email}")
    print(f"Username: {admin_username}")
    print(f"Role: {ADMIN_ROLE}")
    print(f"Database: {settings['mongo_db_name']}")
    print()

    client = None
    try:
        client = MongoClient(
            settings["mongo_uri"],
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
            socketTimeoutMS=5000,
            retryWrites=True,
        )
        client.admin.command("ping")

        database = client[settings["mongo_db_name"]]
        users = database["users"]

        now = datetime.now(timezone.utc)
        password_hash = generate_password_hash(admin_password)
        existing_user = users.find_one({"email": admin_email})

        if existing_user:
            users.update_one(
                {"_id": existing_user["_id"]},
                {
                    "$set": {
                        "username": admin_username,
                        "password_hash": password_hash,
                        "role": ADMIN_ROLE,
                        "status": ADMIN_STATUS,
                        "is_active": True,
                        "updated_at": now,
                    },
                    "$setOnInsert": {
                        "created_at": now,
                        "last_login": None,
                        "last_login_at": None,
                        "profile_image": None,
                    },
                },
            )
            print("Existing admin account updated successfully.")
        else:
            users.insert_one(
                {
                    "username": admin_username,
                    "email": admin_email,
                    "password_hash": password_hash,
                    "role": ADMIN_ROLE,
                    "status": ADMIN_STATUS,
                    "is_active": True,
                    "created_at": now,
                    "last_login": None,
                    "last_login_at": None,
                    "profile_image": None,
                    "updated_at": now,
                }
            )
            print("Admin account created successfully.")

        print(f"Login email: {admin_email}")
        print("Admin password was read from ADMIN_SEED_PASSWORD and was not printed.")
        return 0
    except (ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError) as exc:
        print(f"Database error: {describe_mongo_error(exc)}")
        print(f"Details: {exc}")
        return 1
    finally:
        if client is not None:
            client.close()


if __name__ == "__main__":
    sys.exit(main())
