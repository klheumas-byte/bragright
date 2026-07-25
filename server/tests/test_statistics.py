from datetime import datetime, timezone

from app.services.statistics_service import (
    build_head_to_head_statistics,
    build_all_player_statistics,
    build_player_statistics,
    eligible_matches,
    is_match_eligible_for_statistics,
    leaderboard_sort_key,
    classify_rank_compatibility,
)


NOW = datetime(2026, 7, 24, 12, tzinfo=timezone.utc)


def match(identifier, a="a", b="b", score=(3, 1), status="confirmed", **extra):
    winner = a if score[0] > score[1] else b if score[1] > score[0] else None
    return {
        "_id": identifier,
        "status": status,
        "player_one_id": a,
        "player_two_id": b,
        "player_one_name": a.upper(),
        "player_two_name": b.upper(),
        "player_one_score": score[0],
        "player_two_score": score[1],
        "winner_id": winner,
        "confirmed_at": NOW,
        **extra,
    }


def test_eligibility_accepts_valid_player_and_admin_results():
    assert is_match_eligible_for_statistics(match("1"))
    assert is_match_eligible_for_statistics(match("2", result_source="admin", reviewed_at=NOW))


def test_eligibility_excludes_every_non_authoritative_status():
    for status in ("pending_confirmation", "pending_result", "match_requested",
                   "cancelled", "expired", "rejected", "disputed"):
        assert not is_match_eligible_for_statistics(match(status, status=status))


def test_eligibility_rejects_bad_participants_scores_winner_and_duplicates():
    assert not is_match_eligible_for_statistics(match("same", a="a", b="a"))
    assert not is_match_eligible_for_statistics(match("negative", score=(-1, 0)))
    assert not is_match_eligible_for_statistics(match("missing", player_one_score=None))
    assert not is_match_eligible_for_statistics(match("winner", winner_id="b"))
    assert not is_match_eligible_for_statistics(match("duplicate", duplicate_of="older"))


def test_player_totals_orientation_draws_clean_sheets_rates_and_form():
    documents = [
        match("win", score=(3, 0)),
        match("loss", a="b", b="a", score=(2, 1)),
        match("draw", score=(0, 0)),
        match("ignored", score=(99, 0), status="cancelled"),
    ]
    stats = build_player_statistics("a", documents)
    assert stats["matches_played"] == 3
    assert (stats["wins"], stats["losses"], stats["draws"]) == (1, 1, 1)
    assert (stats["goals_scored"], stats["goals_conceded"]) == (4, 2)
    assert stats["goal_difference"] == 2
    assert stats["clean_sheets"] == 2
    assert stats["average_goals_scored"] == 1.33
    assert stats["average_goals_conceded"] == 0.67
    assert stats["win_rate"] == 33.3
    assert stats["current_form"][0]["score"] in {"3\u20130", "1\u20132", "0\u20130"}


def test_zero_match_statistics_do_not_divide_by_zero():
    stats = build_player_statistics("a", [])
    assert stats["average_goals_scored"] == stats["average_goals_conceded"] == 0
    assert stats["win_rate"] == 0


def test_duplicate_identity_is_counted_once():
    included, excluded = eligible_matches([match("one"), match("one")])
    assert len(included) == 1
    assert excluded["duplicate_result"] == 1


def test_rebuild_aggregation_matches_individual_live_totals():
    documents = [match("one", score=(4, 1)), match("two", a="b", b="a", score=(2, 2))]
    rebuilt, _ = build_all_player_statistics(documents)
    live = build_player_statistics("a", documents)
    assert rebuilt["a"]["matches_played"] == live["matches_played"] == 2
    assert rebuilt["a"]["goals_scored"] == live["goals_scored"] == 6


def test_head_to_head_totals_latest_biggest_and_invalid_exclusion():
    result = build_head_to_head_statistics("a", "b", [
        match("1", score=(3, 0)),
        match("2", a="b", b="a", score=(2, 2)),
        match("3", score=(9, 0), status="disputed"),
    ])
    assert result["total_meetings"] == 2
    assert (result["player_a_wins"], result["player_b_wins"], result["draws"]) == (1, 0, 1)
    assert (result["player_a_goals"], result["player_b_goals"]) == (5, 2)
    assert result["player_a_goal_difference"] == 3
    assert result["biggest_win"]["margin"] == 3
    assert result["latest_meeting"] is not None


def test_period_scopes_are_utc_safe():
    old = match("old", confirmed_at=datetime(2025, 1, 1, tzinfo=timezone.utc))
    current = match("current")
    included, _ = eligible_matches([old, current], scope="month", now=NOW)
    assert [item["id"] for item in included] == ["current"]


def test_leaderboard_tie_breakers_are_deterministic():
    base = {
        "goals_scored": 5, "goal_difference": 2, "wins": 2,
        "matches_played": 5, "clean_sheets": 1,
        "average_goals_scored": 1, "average_goals_conceded": 1,
        "win_rate": 40, "points": 6,
    }
    entries = [{**base, "id": "b", "username": "Beta"}, {**base, "id": "a", "username": "Alpha"}]
    assert sorted(entries, key=lambda item: leaderboard_sort_key("goals", item))[0]["id"] == "a"


def test_matchmaking_compatibility_uses_official_rank_only():
    assert classify_rank_compatibility(3, 3) == "Balanced"
    assert classify_rank_compatibility(5, 3) == "Slightly Stronger"
    assert classify_rank_compatibility(2, 8) == "Much Weaker"
    assert classify_rank_compatibility(None, 2) == "Unavailable"


def test_statistics_api_and_goal_leaderboard_use_same_authoritative_totals(
    client, create_user, matches
):
    alpha = create_user("stats-alpha@example.com", username="Stats Alpha")
    beta = create_user("stats-beta@example.com", username="Stats Beta")
    matches.insert_one(match(
        "api-result",
        a=str(alpha["_id"]),
        b=str(beta["_id"]),
        score=(5, 2),
    ))
    statistics_response = client.get(f"/api/players/{alpha['_id']}/statistics")
    assert statistics_response.status_code == 200
    assert statistics_response.json["data"]["goals_scored"] == 5
    leaderboard_response = client.get("/api/leaderboard?category=goals&scope=all_time")
    assert leaderboard_response.status_code == 200
    assert leaderboard_response.json["data"]["leaderboard"][0]["goals_scored"] == 5
    assert client.get(f"/api/players/{alpha['_id']}/statistics?scope=season").status_code == 422
