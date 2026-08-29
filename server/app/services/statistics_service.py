"""Authoritative, rebuildable match statistics.

A match contributes only when it is confirmed, has two distinct participants,
has two non-negative whole-number scores whose outcome agrees with winner_id,
and is not marked as superseded or duplicated. A confirmed document is treated
as accepted because both the player and admin workflows can reach ``confirmed``
only after acceptance/result submission; this also preserves valid legacy data.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone


SUPPORTED_SCOPES = {"all_time", "week", "month", "year", "recent_5", "recent_10"}
LEADERBOARD_CATEGORIES = {
    "ranking",
    "goals",
    "wins",
    "goal_difference",
    "clean_sheets",
    "goals_per_match",
    "best_defense",
    "win_rate",
}
MIN_RATE_MATCHES = 5


def classify_rank_compatibility(player_rank, opponent_rank):
    """Presentation-only matchup label based on the existing official rank."""
    try:
        difference = int(opponent_rank) - int(player_rank)
    except (TypeError, ValueError):
        return "Unavailable"
    distance = abs(difference)
    if distance == 0:
        return "Balanced"
    if difference < 0:
        return "Slightly Stronger" if distance <= 2 else "Much Stronger"
    return "Slightly Weaker" if distance <= 2 else "Much Weaker"


def _whole_score(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float) and value.is_integer():
        return int(value) if value >= 0 else None
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def resolve_statistics_match(match):
    """Normalize a match or return ``(None, exclusion_reason)``."""
    status = str(match.get("status") or "").strip().lower().replace("-", "_")
    if status != "confirmed":
        return None, f"status_{status or 'missing'}"
    if match.get("superseded_by") or match.get("duplicate_of") or match.get("is_duplicate"):
        return None, "superseded_or_duplicate"

    player_one_id = str(
        match.get("player_one_id") or match.get("submitted_by") or ""
    ).strip()
    player_two_id = str(
        match.get("player_two_id") or match.get("opponent_id") or ""
    ).strip()
    if not player_one_id or not player_two_id:
        return None, "missing_participant"
    if player_one_id == player_two_id:
        return None, "duplicate_participant"

    player_one_score = _whole_score(
        match.get("player_one_score", match.get("player_score"))
    )
    player_two_score = _whole_score(
        match.get("player_two_score", match.get("opponent_score"))
    )
    if player_one_score is None or player_two_score is None:
        return None, "invalid_or_missing_score"

    expected_winner = (
        player_one_id
        if player_one_score > player_two_score
        else player_two_id
        if player_two_score > player_one_score
        else None
    )
    winner_id = str(match.get("winner_id") or "").strip() or None
    # A forfeit keeps the score as it stood but has a separate competitive
    # outcome.  Do not turn a 2-2 (or a quitter-leading) match into a fake
    # score merely to make the result validate.
    result_type = str(match.get("result_type") or "normal").strip().lower()
    if result_type == "forfeit":
        if winner_id not in {player_one_id, player_two_id}:
            return None, "invalid_forfeit_winner"
    elif winner_id != expected_winner:
        return None, "winner_score_mismatch"

    played_at = (
        match.get("confirmed_at")
        or match.get("reviewed_at")
        or match.get("updated_at")
        or match.get("created_at")
    )
    if played_at is not None and not isinstance(played_at, datetime):
        return None, "invalid_completion_date"

    return {
        "_id": str(match.get("_id") or match.get("id") or ""),
        "id": str(match.get("_id") or match.get("id") or ""),
        "status": "confirmed",
        "player_one_id": player_one_id,
        "player_two_id": player_two_id,
        "player_one_name": match.get("player_one_name")
        or match.get("submitted_by_name")
        or "Unknown player",
        "player_two_name": match.get("player_two_name")
        or match.get("opponent_name")
        or "Unknown opponent",
        "player_one_score": player_one_score,
        "player_two_score": player_two_score,
        "winner_id": expected_winner,
        "competitive_winner_id": winner_id,
        "result_type": result_type,
        "played_at": _as_utc(played_at),
        "confirmed_at": _as_utc(played_at),
        "competition_id": str(
            match.get("competition_id") or match.get("tournament_id") or ""
        ).strip()
        or None,
        "game": str(match.get("game") or match.get("game_type") or "").strip()
        or None,
        "result_source": match.get("result_source") or "player",
    }, None


def is_match_eligible_for_statistics(match):
    return resolve_statistics_match(match)[0] is not None


def eligible_matches(match_documents, *, scope="all_time", now=None,
                     competition_id=None, game=None):
    if scope not in SUPPORTED_SCOPES:
        raise ValueError("Statistics scope is invalid.")
    now = _as_utc(now or datetime.now(timezone.utc))
    seen = set()
    included = []
    excluded = defaultdict(int)

    for raw_match in match_documents:
        normalized, reason = resolve_statistics_match(raw_match)
        if reason:
            excluded[reason] += 1
            continue
        dedupe_key = normalized["id"] or (
            normalized["player_one_id"],
            normalized["player_two_id"],
            normalized["played_at"],
            normalized["player_one_score"],
            normalized["player_two_score"],
        )
        if dedupe_key in seen:
            excluded["duplicate_result"] += 1
            continue
        seen.add(dedupe_key)
        if competition_id and normalized["competition_id"] != str(competition_id):
            excluded["outside_competition"] += 1
            continue
        if game and (normalized["game"] or "").casefold() != str(game).casefold():
            excluded["outside_game"] += 1
            continue
        if not _in_period(normalized["played_at"], scope, now):
            excluded["outside_scope"] += 1
            continue
        included.append(normalized)

    included.sort(key=lambda item: item["played_at"] or datetime.min.replace(
        tzinfo=timezone.utc), reverse=True)
    if scope == "recent_5":
        included = included[:5]
    elif scope == "recent_10":
        included = included[:10]
    return included, dict(excluded)


def build_player_statistics(player_id, match_documents, *, scope="all_time",
                            now=None, competition_id=None, game=None):
    match_documents = [
        match for match in match_documents
        if player_id in {
            str(match.get("player_one_id") or match.get("submitted_by") or "").strip(),
            str(match.get("player_two_id") or match.get("opponent_id") or "").strip(),
        }
    ]
    matches, excluded = eligible_matches(
        match_documents,
        scope=scope,
        now=now,
        competition_id=competition_id,
        game=game,
    )
    matches = [
        match for match in matches
        if player_id in {match["player_one_id"], match["player_two_id"]}
    ]
    totals = _empty_statistics(player_id, scope, competition_id, game)
    win_streak = 0
    longest_win_streak = 0
    chronological_results = []

    for match in reversed(matches):
        oriented = orient_match(match, player_id)
        result = oriented["result"]
        chronological_results.append(result)
        if result == "win":
            win_streak += 1
            longest_win_streak = max(longest_win_streak, win_streak)
        else:
            win_streak = 0

    current_win_streak = 0
    for result in reversed(chronological_results):
        if result != "win":
            break
        current_win_streak += 1

    for match in matches:
        oriented = orient_match(match, player_id)
        totals["matches_played"] += 1
        totals["goals_scored"] += oriented["player_score"]
        totals["goals_conceded"] += oriented["opponent_score"]
        result_key = {"win": "wins", "loss": "losses", "draw": "draws"}[oriented["result"]]
        totals[result_key] += 1
        if oriented["opponent_score"] == 0:
            totals["clean_sheets"] += 1

        margin = oriented["player_score"] - oriented["opponent_score"]
        total_goals = oriented["player_score"] + oriented["opponent_score"]
        if totals["highest_scoring_match"] is None or total_goals > totals["highest_scoring_match"]["total_goals"]:
            totals["highest_scoring_match"] = {**oriented, "total_goals": total_goals}
        if margin > 0 and (totals["biggest_win"] is None or margin > totals["biggest_win"]["margin"]):
            totals["biggest_win"] = {**oriented, "margin": margin}
        if margin < 0 and (totals["biggest_defeat"] is None or margin < totals["biggest_defeat"]["margin"]):
            totals["biggest_defeat"] = {**oriented, "margin": margin}

    count = totals["matches_played"]
    totals["goal_difference"] = totals["goals_scored"] - totals["goals_conceded"]
    totals["average_goals_scored"] = _average(totals["goals_scored"], count)
    totals["average_goals_conceded"] = _average(totals["goals_conceded"], count)
    totals["win_rate"] = _percentage(totals["wins"], count)
    totals["unbeaten_rate"] = _percentage(totals["wins"] + totals["draws"], count)
    totals["current_win_streak"] = current_win_streak
    totals["longest_win_streak"] = longest_win_streak
    totals["current_form"] = [
        orient_match(match, player_id) for match in matches[:5]
    ]
    totals["excluded_match_counts"] = excluded
    return totals


def build_all_player_statistics(match_documents, *, scope="all_time", now=None,
                                competition_id=None, game=None):
    matches, excluded = eligible_matches(
        match_documents, scope=scope, now=now,
        competition_id=competition_id, game=game,
    )
    player_ids = {
        player_id
        for match in matches
        for player_id in (match["player_one_id"], match["player_two_id"])
    }
    stats = {
        player_id: build_player_statistics(
            player_id, matches, scope="all_time",
            competition_id=competition_id, game=game,
        )
        for player_id in player_ids
    }
    return stats, excluded


def build_head_to_head_statistics(player_a_id, player_b_id, match_documents):
    matches, excluded = eligible_matches(match_documents)
    meetings = [
        match for match in matches
        if {match["player_one_id"], match["player_two_id"]}
        == {player_a_id, player_b_id}
    ]
    result = {
        "scope": "all_time",
        "scope_label": "All time",
        "total_meetings": len(meetings),
        "player_a_wins": 0,
        "player_b_wins": 0,
        "draws": 0,
        "player_a_goals": 0,
        "player_b_goals": 0,
        "player_a_goal_difference": 0,
        "player_b_goal_difference": 0,
        "player_a_clean_sheets": 0,
        "player_b_clean_sheets": 0,
        "latest_meeting": None,
        "biggest_win": None,
        "highest_scoring_meeting": None,
        "recent_form": [],
        "excluded_match_counts": excluded,
    }
    for match in meetings:
        a = orient_match(match, player_a_id)
        b = orient_match(match, player_b_id)
        result["player_a_goals"] += a["player_score"]
        result["player_b_goals"] += b["player_score"]
        if a["result"] == "win":
            result["player_a_wins"] += 1
        elif a["result"] == "loss":
            result["player_b_wins"] += 1
        else:
            result["draws"] += 1
        if a["opponent_score"] == 0:
            result["player_a_clean_sheets"] += 1
        if b["opponent_score"] == 0:
            result["player_b_clean_sheets"] += 1
        margin = abs(a["player_score"] - a["opponent_score"])
        meeting = {**a, "margin": margin}
        if margin and (result["biggest_win"] is None or margin > result["biggest_win"]["margin"]):
            result["biggest_win"] = meeting
        total_goals = a["player_score"] + a["opponent_score"]
        if result["highest_scoring_meeting"] is None or total_goals > result["highest_scoring_meeting"]["total_goals"]:
            result["highest_scoring_meeting"] = {**a, "total_goals": total_goals}
        result["recent_form"].append(a)

    result["player_a_goal_difference"] = result["player_a_goals"] - result["player_b_goals"]
    result["player_b_goal_difference"] = -result["player_a_goal_difference"]
    result["latest_meeting"] = result["recent_form"][0] if meetings else None
    result["recent_form"] = result["recent_form"][:5]
    return result


def orient_match(match, player_id):
    is_one = match["player_one_id"] == player_id
    player_score = match["player_one_score"] if is_one else match["player_two_score"]
    opponent_score = match["player_two_score"] if is_one else match["player_one_score"]
    opponent_id = match["player_two_id"] if is_one else match["player_one_id"]
    opponent_name = match["player_two_name"] if is_one else match["player_one_name"]
    competitive_winner = match.get("competitive_winner_id", match["winner_id"])
    result = "draw" if competitive_winner is None else "win" if competitive_winner == player_id else "loss"
    return {
        "match_id": match["id"],
        "id": match["id"],
        "status": "confirmed",
        "result": result,
        "player_score": player_score,
        "opponent_score": opponent_score,
        "score": f"{player_score}\u2013{opponent_score}",
        "score_line": f"{player_score}\u2013{opponent_score}",
        "opponent_id": opponent_id,
        "opponent_name": opponent_name,
        "played_at": match["played_at"].isoformat() if match["played_at"] else None,
        "confirmed_at": match["played_at"].isoformat() if match["played_at"] else None,
        "winner_id": competitive_winner,
        "result_type": match.get("result_type", "normal"),
    }


def leaderboard_sort_key(category, entry):
    stable = (entry.get("username") or "").casefold(), entry["id"]
    if category == "goals":
        return (-entry["goals_scored"], -entry["goal_difference"], -entry["wins"], *stable)
    if category == "wins":
        return (-entry["wins"], -entry["goal_difference"], *stable)
    if category == "goal_difference":
        return (-entry["goal_difference"], -entry["wins"], entry["matches_played"], *stable)
    if category == "clean_sheets":
        return (-entry["clean_sheets"], entry["matches_played"], -entry["goal_difference"], *stable)
    if category == "goals_per_match":
        return (-entry["average_goals_scored"], -entry["goal_difference"], -entry["wins"], *stable)
    if category == "best_defense":
        return (entry["average_goals_conceded"], -entry["clean_sheets"], -entry["goal_difference"], *stable)
    if category == "win_rate":
        return (-entry["win_rate"], -entry["wins"], -entry["goal_difference"], *stable)
    return (-entry["points"], -entry["wins"], *stable)


def _empty_statistics(player_id, scope, competition_id, game):
    return {
        "player_id": player_id,
        "scope": scope,
        "scope_label": {
            "all_time": "All time", "week": "Current week",
            "month": "Current month", "year": "Current year",
            "recent_5": "Recent 5", "recent_10": "Recent 10",
        }[scope],
        "competition_id": competition_id,
        "game": game,
        "matches_played": 0, "wins": 0, "losses": 0, "draws": 0,
        "goals_scored": 0, "goals_conceded": 0, "goal_difference": 0,
        "clean_sheets": 0, "average_goals_scored": 0.0,
        "average_goals_conceded": 0.0, "win_rate": 0.0,
        "unbeaten_rate": 0.0, "current_form": [],
        "current_win_streak": 0, "longest_win_streak": 0,
        "highest_scoring_match": None, "biggest_win": None,
        "biggest_defeat": None,
    }


def _average(value, total):
    return round(value / total, 2) if total else 0.0


def _percentage(value, total):
    return round(value / total * 100, 1) if total else 0.0


def _as_utc(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _in_period(played_at, scope, now):
    if scope == "all_time" or scope.startswith("recent_"):
        return True
    if played_at is None:
        return False
    if scope == "week":
        start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    elif scope == "month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return start <= played_at <= now
