"""Safely run or preview the calendar-month subscription process."""

import argparse

from app.config import Config
from app.db import ensure_subscription_indexes, init_db
from app.services.subscription_service import run_monthly_billing


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--billing-month", help="YYYY-MM; defaults to the current month")
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()

    database = init_db(config=Config.__dict__)
    ensure_subscription_indexes(database)
    summary = run_monthly_billing(
        Config.__dict__,
        {"id": "system", "username": "Billing process", "role": "system"},
        arguments.billing_month,
        dry_run=arguments.dry_run,
    )
    for key, value in summary.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
