from bson import ObjectId
from bson.errors import InvalidId
from pymongo import DESCENDING


POINTS_FOR_WIN = 3
POINTS_FOR_DRAW = 1
RECENT_MATCH_LIMIT = 5


def build_leaderboard(users_collection, matches_collection):
    users = list(users_collection.find({}, {"password_hash": 0}))
    confirmed_matches = list(
        matches_collection.find({"status": "confirmed"}).sort("confirmed_at", DESCENDING)
    )

    stats_by_player = {
        str(user["_id"]): {
            "id": str(user["_id"]),
            "username": user.get("username", "Player"),
            "total_matches": 0,
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "points": 0,
        }
        for user in users
    }

    for match in confirmed_matches:
        _apply_match_to_stats(stats_by_player, match)

    sorted_players = sorted(
        stats_by_player.values(),
        key=lambda player: (-player["points"], -player["wins"], player["username"].lower()),
    )

    leaderboard = []
    for index, player in enumerate(sorted_players, start=1):
        leaderboard.append(
            {
                **player,
                "rank": index,
            }
        )

    return leaderboard


def build_public_player_profile(player_id, users_collection, matches_collection):
    try:
        player_object_id = ObjectId(player_id)
    except InvalidId as error:
        raise ValueError("Player ID is invalid.") from error

    player = users_collection.find_one({"_id": player_object_id}, {"password_hash": 0})
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

    recent_confirmed_matches = list(
        matches_collection.find(
            {
                "status": "confirmed",
                "$or": [
                    {"submitted_by": player_id},
                    {"opponent_id": player_id},
                ],
            }
        ).sort("confirmed_at", DESCENDING).limit(RECENT_MATCH_LIMIT)
    )

    recent_summary = [
        _serialize_public_match_summary(match, player_id)
        for match in recent_confirmed_matches
    ]

    return {
        "id": player_summary["id"],
        "username": player_summary["username"],
        "total_matches": player_summary["total_matches"],
        "wins": player_summary["wins"],
        "losses": player_summary["losses"],
        "draws": player_summary["draws"],
        "points": player_summary["points"],
        "rank": player_summary["rank"],
        "win_rate": _calculate_win_rate(player_summary["wins"], player_summary["total_matches"]),
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

    player_a = users_collection.find_one({"_id": player_a_object_id}, {"password_hash": 0})
    player_b = users_collection.find_one({"_id": player_b_object_id}, {"password_hash": 0})

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

    summary = {
        "player_a": {
            "id": player_a_id,
            "username": player_a.get("username", "Player A"),
        },
        "player_b": {
            "id": player_b_id,
            "username": player_b.get("username", "Player B"),
        },
        "total_matches": 0,
        "player_a_wins": 0,
        "player_b_wins": 0,
        "draws": 0,
        "player_a_points": 0,
        "player_b_points": 0,
        "leader": "draw",
        "most_recent_result": None,
        "recent_matches": [],
    }

    for match in rivalry_matches:
        player_a_score, player_b_score = _resolve_head_to_head_scores(match, player_a_id, player_b_id)
        summary["total_matches"] += 1
        summary["player_a_points"] += player_a_score
        summary["player_b_points"] += player_b_score

        winner_id = match.get("winner_id")
        if not winner_id:
            summary["draws"] += 1
        elif winner_id == player_a_id:
            summary["player_a_wins"] += 1
        elif winner_id == player_b_id:
            summary["player_b_wins"] += 1

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
        player_score = match.get("player_score", 0)
        opponent_score = match.get("opponent_score", 0)
        opponent_label = opponent_name
    else:
        player_score = match.get("opponent_score", 0)
        opponent_score = match.get("player_score", 0)
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
        return match.get("player_score", 0), match.get("opponent_score", 0)

    if submitted_by == player_b_id:
        return match.get("opponent_score", 0), match.get("player_score", 0)

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
