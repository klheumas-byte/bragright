import sys

from pymongo import MongoClient
from pymongo.errors import ConfigurationError, ConnectionFailure, OperationFailure, PyMongoError

from app.db import (
    ACTIVITY_LOGS_COLLECTION_NAME,
    LOGIN_ACTIVITY_COLLECTION_NAME,
    MATCHES_COLLECTION_NAME,
    SETTINGS_COLLECTION_NAME,
    USERS_COLLECTION_NAME,
    describe_mongo_error,
    get_mongo_settings,
)


APP_COLLECTIONS = [
    USERS_COLLECTION_NAME,
    MATCHES_COLLECTION_NAME,
    SETTINGS_COLLECTION_NAME,
    LOGIN_ACTIVITY_COLLECTION_NAME,
    ACTIVITY_LOGS_COLLECTION_NAME,
]


def main():
    try:
        settings = get_mongo_settings()
    except RuntimeError as exc:
        print(f"Configuration error: {exc}")
        return 1

    db_name = settings["mongo_db_name"]
    uri_preview = settings["env_details"]["mongo_uri_preview"]

    print("This will permanently delete this app's MongoDB collections:")
    for name in APP_COLLECTIONS:
        print(f" - {name}")
    print(f"Database: {db_name}")
    print(f"URI: {uri_preview}")
    print()

    confirmation = input("Type DELETE to continue: ").strip()
    if confirmation != "DELETE":
        print("Cancelled. No collections were deleted.")
        return 0

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
        database = client[db_name]

        existing_collections = set(database.list_collection_names())
        deleted_any = False

        for name in APP_COLLECTIONS:
            if name in existing_collections:
                database.drop_collection(name)
                deleted_any = True
                print(f"Dropped collection: {name}")
            else:
                print(f"Collection not found, skipped: {name}")

        if not deleted_any:
            print("No app collections were present in the database.")
        else:
            print("Finished deleting app collections.")

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
