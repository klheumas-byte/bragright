"""Audit and rebuild BragRight statistics from authoritative match history.

The current architecture is live aggregation, so this command never mutates
matches or player profiles. ``--apply`` is accepted for operational symmetry
and performs the same reconciliation report.
"""

import argparse
from collections import Counter

from app import create_app
from app.db import get_matches_collection
from app.services.statistics_service import (
    build_all_player_statistics,
    resolve_statistics_match,
)


def rebuild_statistics(matches_collection, *, batch_size=500, progress=print):
    inspected = included = 0
    reasons = Counter()
    valid_matches = []
    cursor = matches_collection.find({}).batch_size(batch_size)
    for document in cursor:
        inspected += 1
        normalized, reason = resolve_statistics_match(document)
        if reason:
            reasons[reason] += 1
        else:
            included += 1
            valid_matches.append(document)
        if inspected % batch_size == 0:
            progress(f"Inspected {inspected} matches...")

    statistics, duplicate_reasons = build_all_player_statistics(valid_matches)
    reasons.update(duplicate_reasons)
    goals = sum(item["goals_scored"] for item in statistics.values())
    invalid_reason_names = {
        "missing_participant",
        "duplicate_participant",
        "invalid_or_missing_score",
        "winner_score_mismatch",
        "invalid_completion_date",
        "superseded_or_duplicate",
        "duplicate_result",
    }
    summary = {
        "matches_inspected": inspected,
        "matches_included": included,
        "matches_excluded": inspected - included,
        "invalid_records": sum(
            count for reason, count in reasons.items()
            if reason in invalid_reason_names
        ),
        "players_updated": len(statistics),
        "player_match_contributions": sum(
            item["matches_played"] for item in statistics.values()
        ),
        "total_player_goals": goals,
        "excluded_reasons": dict(sorted(reasons.items())),
    }
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Run reconciliation (no stored counters are changed).")
    parser.add_argument("--batch-size", type=int, default=500)
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error("--batch-size must be positive")

    app = create_app()
    with app.app_context():
        summary = rebuild_statistics(
            get_matches_collection(config=app.config, logger=app.logger),
            batch_size=args.batch_size,
        )
    print("Mode:", "reconcile" if args.apply else "dry-run")
    for key, value in summary.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
