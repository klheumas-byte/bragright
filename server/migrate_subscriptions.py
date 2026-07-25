"""Idempotently install BragRight subscription collection indexes."""

from app.config import Config
from app.db import ensure_subscription_indexes, init_db


def main():
    database = init_db(config=Config.__dict__)
    ensure_subscription_indexes(database)
    print("Subscription collections and unique indexes are ready.")


if __name__ == "__main__":
    main()
