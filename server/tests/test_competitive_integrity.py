from datetime import datetime, timedelta, timezone

from app.services.competitive_service import build_leaderboard
from app.services.leaderboard_reign_service import reconstruct_reigns, reign_summary
from app.services.statistics_service import build_player_statistics


def _match(identifier, one, two, score, winner, at, **extra):
    return {"_id": identifier, "status": "confirmed", "player_one_id": one, "player_two_id": two,
            "submitted_by": one, "opponent_id": two, "player_one_score": score[0], "player_two_score": score[1],
            "winner_id": winner, "confirmed_at": at, **extra}


def test_forfeit_preserves_actual_score_but_uses_competitive_outcome_and_four_points(users, matches, create_user):
    alpha = create_user("integrity-a@example.com", username="Alpha")
    beta = create_user("integrity-b@example.com", username="Beta")
    match = _match("forfeit", str(alpha["_id"]), str(beta["_id"]), (2, 2), str(alpha["_id"]), datetime.now(timezone.utc), result_type="forfeit", quit_by=str(beta["_id"]))
    matches.insert_one(match)
    stats = build_player_statistics(str(alpha["_id"]), [match])
    assert (stats["goals_scored"], stats["goals_conceded"], stats["wins"]) == (2, 2, 1)
    board = build_leaderboard(users, matches)
    alpha_entry = next(item for item in board if item["id"] == str(alpha["_id"]))
    beta_entry = next(item for item in board if item["id"] == str(beta["_id"]))
    assert (alpha_entry["points"], beta_entry["points"]) == (4, 0)


def test_reigns_are_reconstructed_only_from_authoritative_chronological_results():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    users = [{"_id": "a", "username": "Alpha", "role": "player"}, {"_id": "b", "username": "Beta", "role": "player"}]
    matches = [_match("1", "a", "b", (1, 0), "a", now), _match("2", "a", "b", (0, 1), "b", now + timedelta(days=2), result_type="forfeit")]
    reigns = reconstruct_reigns(users, matches, now=now + timedelta(days=5))
    assert [item["player_id"] for item in reigns] == ["a", "b"]
    assert reigns[0]["ended_at"] == now + timedelta(days=2)
    summary = reign_summary(reigns, now=now + timedelta(days=5))
    assert summary["current"]["player_id"] == "b"
    assert summary["total_seconds_by_player"]["a"] == 2 * 24 * 60 * 60
