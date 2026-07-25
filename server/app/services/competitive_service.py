from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING

from .statistics_service import (
    MIN_RATE_MATCHES,
    build_head_to_head_statistics,
    build_player_statistics,
    is_match_eligible_for_statistics,
    classify_rank_compatibility,
    leaderboard_sort_key,
)


POINTS_FOR_WIN = 3
POINTS_FOR_DRAW = 1
RECENT_MATCH_LIMIT = 5


def build_leaderboard(users_collection, matches_collection, *, category="ranking",
                      scope="all_time", competition_id=None, game=None,
                      minimum_matches=MIN_RATE_MATCHES):
    users = list(
        users_collection.find(
            {"role": "player", "status": {"$ne": "disabled"}},
            {"username": 1, "profile_image": 1},
        )
    )
    confirmed_matches = list(matches_collection.find({"status": "confirmed"}))

    stats_by_player = {
        str(user["_id"]): {
            "id": str(user["_id"]),
            "username": user.get("username", "Player"),
            "profile_image": user.get("profile_image") or "",
            **build_player_statistics(
                str(user["_id"]),
                confirmed_matches,
                scope=scope,
                competition_id=competition_id,
                game=game,
            ),
        }
        for user in users
    }

    for player in stats_by_player.values():
        player["total_matches"] = player["matches_played"]
        player["points"] = player["wins"] * POINTS_FOR_WIN + player["draws"] * POINTS_FOR_DRAW

    # Preserve the established official ranking formula and historical behavior.
    # Advanced statistical categories below continue to require valid scores.
    if category == "ranking":
        ranking_counters = {
            player_id: {
                "total_matches": 0, "wins": 0, "losses": 0,
                "draws": 0, "points": 0,
            }
            for player_id in stats_by_player
        }
        for match in confirmed_matches:
            _apply_match_to_stats(ranking_counters, match)
        for player_id, counters in ranking_counters.items():
            stats_by_player[player_id].update(counters)
            stats_by_player[player_id]["win_rate"] = _calculate_win_rate(
                counters["wins"], counters["total_matches"]
            )

    if category != "ranking":
        stats_by_player = {
            player_id: player
            for player_id, player in stats_by_player.items()
            if player["matches_played"] > 0
        }

    if category in {"goals_per_match", "best_defense", "win_rate"}:
        stats_by_player = {
            player_id: player
            for player_id, player in stats_by_player.items()
            if player["matches_played"] >= minimum_matches
        }

    sorted_players = sorted(
        stats_by_player.values(),
        key=lambda player: leaderboard_sort_key(category, player),
    )

    leaderboard = []
    for index, player in enumerate(sorted_players, start=1):
        leaderboard.append(
            {
                **player,
                "rank": index,
                "category": category,
                "minimum_matches": minimum_matches if category in {"goals_per_match", "best_defense", "win_rate"} else 0,
            }
        )

    return leaderboard
def build_public_player_profile(player_id, users_collection, matches_collection):
    try:
        player_object_id = ObjectId(player_id)
    except InvalidId as error:
        raise ValueError("Player ID is invalid.") from error

    player = users_collection.find_one(
        {
            "_id": player_object_id,
            "role": "player",
            "status": {"$ne": "disabled"},
        },
        {"username": 1, "profile_image": 1, "created_at": 1, "status": 1},
    )
    if not player:
        raise LookupError("Player was not found.")

    leaderboard = build_leaderboard(users_collection, matches_collection)
    player_summary = next((entry for entry in leaderboard if entry["id"] == player_id), None)

    if not player_summary:
        player_summary = {
            "id": player_id,
            "username": player.get("username", "Player"),
            "total_matches": 0,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "points": 0,
            "rank": len(leaderboard) + 1 if leaderboard else 1,
        }

    all_confirmed_matches = list(
        matches_collection.find(
            {
                "status": "confirmed",
                "$or": [
                    {"submitted_by": player_id},
                    {"opponent_id": player_id},
                ],
            }
        ).sort("confirmed_at", DESCENDING)
    )
    statistics = build_player_statistics(player_id, all_confirmed_matches)
    recent_confirmed_matches = [
        match for match in all_confirmed_matches
        if is_match_eligible_for_statistics(match)
    ][:RECENT_MATCH_LIMIT]

    recent_summary = [
        _serialize_public_match_summary(match, player_id)
        for match in recent_confirmed_matches
    ]

    return {
        "id": player_summary["id"],
        "username": player_summary["username"],
        "profile_image": player.get("profile_image") or "",
        "created_at": player.get("created_at").isoformat() if player.get("created_at") else None,
        "status": str(player.get("status") or "active").lower(),
        "total_matches": player_summary["total_matches"],
        "wins": player_summary["wins"],
        "losses": player_summary["losses"],
        "draws": player_summary["draws"],
        "points": player_summary["points"],
        "rank": player_summary["rank"],
        "win_rate": _calculate_win_rate(player_summary["wins"], player_summary["total_matches"]),
        "statistics": statistics,
        "matches_played": statistics["matches_played"],
        "goals_scored": statistics["goals_scored"],
        "goals_conceded": statistics["goals_conceded"],
        "goal_difference": statistics["goal_difference"],
        "clean_sheets": statistics["clean_sheets"],
        "average_goals_scored": statistics["average_goals_scored"],
        "average_goals_conceded": statistics["average_goals_conceded"],
        "current_form": statistics["current_form"],
        "current_win_streak": statistics["current_win_streak"],
        "longest_win_streak": statistics["longest_win_streak"],
        "biggest_win": statistics["biggest_win"],
        "recent_confirmed_matches": recent_summary,
    }


def build_head_to_head(player_a_id, player_b_id, users_collection, matches_collection):
    if player_a_id == player_b_id:
        raise ValueError("Choose two different players for a head-to-head comparison.")

    try:
        player_a_object_id = ObjectId(player_a_id)
        player_b_object_id = ObjectId(player_b_id)
    except InvalidId as error:
        raise ValueError("One or both player IDs are invalid.") from error

    public_player_query = {
        "role": "player",
        "status": {"$ne": "disabled"},
    }
    player_documents = list(
        users_collection.find(
            {
                "_id": {"$in": [player_a_object_id, player_b_object_id]},
                **public_player_query,
            },
            {"username": 1},
        )
    )
    players_by_id = {str(player["_id"]): player for player in player_documents}
    player_a = players_by_id.get(player_a_id)
    player_b = players_by_id.get(player_b_id)

    if not player_a or not player_b:
        raise LookupError("One or both players were not found.")

    rivalry_matches = list(
        matches_collection.find(
            {
                "status": "confirmed",
                "$or": [
                    {
                        "submitted_by": player_a_id,
                        "opponent_id": player_b_id,
                    },
                    {
                        "submitted_by": player_b_id,
                        "opponent_id": player_a_id,
                    },
                ],
            }
        ).sort("confirmed_at", DESCENDING)
    )

    analytics = build_head_to_head_statistics(player_a_id, player_b_id, rivalry_matches)
    summary = {
        "player_a": {
            "id": player_a_id,
            "username": player_a.get("username", "Player A"),
        },
        "player_b": {
            "id": player_b_id,
            "username": player_b.get("username", "Player B"),
        },
        "total_matches": analytics["total_meetings"],
        "total_meetings": analytics["total_meetings"],
        "player_a_wins": analytics["player_a_wins"],
        "player_b_wins": analytics["player_b_wins"],
        "draws": analytics["draws"],
        "player_a_points": analytics["player_a_goals"],
        "player_b_points": analytics["player_b_goals"],
        "player_a_goals": analytics["player_a_goals"],
        "player_b_goals": analytics["player_b_goals"],
        "player_a_goal_difference": analytics["player_a_goal_difference"],
        "player_b_goal_difference": analytics["player_b_goal_difference"],
        "player_a_clean_sheets": analytics["player_a_clean_sheets"],
        "player_b_clean_sheets": analytics["player_b_clean_sheets"],
        "biggest_win": analytics["biggest_win"],
        "highest_scoring_meeting": analytics["highest_scoring_meeting"],
        "leader": "draw",
        "most_recent_result": None,
        "recent_matches": [],
    }

    for match in rivalry_matches:
        if not is_match_eligible_for_statistics(match):
            continue
        player_a_score, player_b_score = _resolve_head_to_head_scores(match, player_a_id, player_b_id)
        winner_id = match.get("winner_id")

        serialized_match = {
            "match_id": str(match["_id"]),
            "confirmed_at": match.get("confirmed_at").isoformat() if match.get("confirmed_at") else None,
            "player_a_score": player_a_score,
            "player_b_score": player_b_score,
            "winner_id": winner_id,
            "result_label": _resolve_head_to_head_result_label(winner_id, player_a, player_b),
        }
        summary["recent_matches"].append(serialized_match)

    if summary["player_a_wins"] > summary["player_b_wins"]:
        summary["leader"] = "player_a"
    elif summary["player_b_wins"] > summary["player_a_wins"]:
        summary["leader"] = "player_b"

    if summary["recent_matches"]:
        summary["most_recent_result"] = summary["recent_matches"][0]

    ranking = build_leaderboard(users_collection, matches_collection)
    ranks = {entry["id"]: entry["rank"] for entry in ranking}
    summary["matchmaking_context"] = {
        "basis": "official_rank",
        "player_a_rank": ranks.get(player_a_id),
        "player_b_rank": ranks.get(player_b_id),
        "player_a_view": classify_rank_compatibility(
            ranks.get(player_a_id), ranks.get(player_b_id)
        ),
        "advisory_only": True,
    }

    return summary


def _apply_match_to_stats(stats_by_player, match):
    submitted_by = match.get("submitted_by")
    opponent_id = match.get("opponent_id")
    winner_id = match.get("winner_id")

    if submitted_by not in stats_by_player or opponent_id not in stats_by_player:
        return

    submitted_player = stats_by_player[submitted_by]
    opponent_player = stats_by_player[opponent_id]

    submitted_player["total_matches"] += 1
    opponent_player["total_matches"] += 1

    if not winner_id:
        submitted_player["draws"] += 1
        opponent_player["draws"] += 1
        submitted_player["points"] += POINTS_FOR_DRAW
        opponent_player["points"] += POINTS_FOR_DRAW
        return

    if winner_id == submitted_by:
        submitted_player["wins"] += 1
        submitted_player["points"] += POINTS_FOR_WIN
        opponent_player["losses"] += 1
        return

    if winner_id == opponent_id:
        opponent_player["wins"] += 1
        opponent_player["points"] += POINTS_FOR_WIN
        submitted_player["losses"] += 1


def _serialize_public_match_summary(match, player_id):
    submitted_by = match.get("submitted_by")
    submitted_by_name = match.get("submitted_by_name", "Unknown player")
    opponent_id = match.get("opponent_id")
    opponent_name = match.get("opponent_name", "Unknown opponent")
    winner_id = match.get("winner_id")
    confirmed_at = match.get("confirmed_at")

    if submitted_by == player_id:
        player_score = match.get("player_one_score", match.get("player_score", 0))
        opponent_score = match.get("player_two_score", match.get("opponent_score", 0))
        opponent_label = opponent_name
    else:
        player_score = match.get("player_two_score", match.get("opponent_score", 0))
        opponent_score = match.get("player_one_score", match.get("player_score", 0))
        opponent_label = submitted_by_name

    if not winner_id:
        result = "draw"
    elif winner_id == player_id:
        result = "win"
    else:
        result = "loss"

    return {
        "match_id": str(match["_id"]),
        "opponent_id": opponent_id if submitted_by == player_id else submitted_by,
        "opponent_name": opponent_label,
        "player_score": player_score,
        "opponent_score": opponent_score,
        "result": result,
        "confirmed_at": confirmed_at.isoformat() if confirmed_at else None,
    }


def _resolve_head_to_head_scores(match, player_a_id, player_b_id):
    submitted_by = match.get("submitted_by")

    if submitted_by == player_a_id:
        return (
            match.get("player_one_score", match.get("player_score", 0)),
            match.get("player_two_score", match.get("opponent_score", 0)),
        )

    if submitted_by == player_b_id:
        return (
            match.get("player_two_score", match.get("opponent_score", 0)),
            match.get("player_one_score", match.get("player_score", 0)),
        )

    return 0, 0


def _resolve_head_to_head_result_label(winner_id, player_a, player_b):
    if not winner_id:
        return "Draw"

    if winner_id == str(player_a["_id"]):
        return f"{player_a.get('username', 'Player A')} won"

    if winner_id == str(player_b["_id"]):
        return f"{player_b.get('username', 'Player B')} won"

    return "Result recorded"


def _calculate_win_rate(wins, total_matches):
    if total_matches <= 0:
        return 0

    return round((wins / total_matches) * 100, 1)
