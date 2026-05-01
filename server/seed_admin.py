import sys
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.errors import ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError
from werkzeug.security import generate_password_hash

from app.db import describe_mongo_error, get_mongo_settings


ADMIN_EMAIL = "bragadmin@gmail.com"
ADMIN_USERNAME = "bragadmin"
ADMIN_PASSWORD = "bragadmiN"
ADMIN_ROLE = "admin"
ADMIN_STATUS = "active"


def main():
    try:
        settings = get_mongo_settings()
    except RuntimeError as exc:
        print(f"Configuration error: {exc}")
        return 1

    print("This script will create or update the admin account below:")
    print(f"Email: {ADMIN_EMAIL}")
    print(f"Username: {ADMIN_USERNAME}")
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
        users.create_index("email", unique=True)
        users.create_index("username")

        now = datetime.now(timezone.utc)
        password_hash = generate_password_hash(ADMIN_PASSWORD)
        existing_user = users.find_one({"email": ADMIN_EMAIL})

        if existing_user:
            users.update_one(
                {"_id": existing_user["_id"]},
                {
                    "$set": {
                        "username": ADMIN_USERNAME,
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
                    "username": ADMIN_USERNAME,
                    "email": ADMIN_EMAIL,
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

        print(f"Login email: {ADMIN_EMAIL}")
        print(f"Password: {ADMIN_PASSWORD}")
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
