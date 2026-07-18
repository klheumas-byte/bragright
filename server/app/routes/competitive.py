from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from pymongo.errors import PyMongoError

from ..db import (
    describe_mongo_error,
    get_db_debug_snapshot,
    get_matches_collection,
    get_users_collection,
)
from ..services.competitive_service import build_head_to_head, build_leaderboard, build_public_player_profile
from ..services.api_security import api_error, pagination_metadata, parse_bounded_int_query


competitive_bp = Blueprint("competitive", __name__)


@competitive_bp.get("/leaderboard")
def get_leaderboard():
    try:
        unsupported_parameters = sorted(
            set(request.args) - {"page", "limit", "search", "player_id"}
        )
        if unsupported_parameters:
            return api_error(
                "The leaderboard query contains unsupported parameters.",
                422,
                details={"fields": unsupported_parameters},
            )

        search = " ".join(str(request.args.get("search") or "").strip().split())
        if len(search) > 64:
            return api_error("Leaderboard search must be 64 characters or fewer.", 422)

        player_id = str(request.args.get("player_id") or "").strip()
        if player_id:
            try:
                ObjectId(player_id)
            except InvalidId:
                return api_error("Player ID is invalid.", 400)

        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        leaderboard = build_leaderboard(users, matches)
        ranked_total = len(leaderboard)
        top_players = leaderboard[:3]
        current_player_index = next(
            (
                index
                for index, entry in enumerate(leaderboard)
                if entry["id"] == player_id
            ),
            None,
        )
        current_player = (
            leaderboard[current_player_index]
            if current_player_index is not None
            else None
        )
        if current_player_index is not None:
            nearby_start = max(0, current_player_index - 1)
            nearby_end = min(len(leaderboard), current_player_index + 2)
            nearby_players = leaderboard[nearby_start:nearby_end]
        else:
            nearby_players = []
        if search:
            normalized_search = search.casefold()
            filtered_leaderboard = [
                entry
                for entry in leaderboard
                if normalized_search
                in " ".join(entry["username"].split()).casefold()
            ]
        else:
            filtered_leaderboard = leaderboard

        page, page_error = parse_bounded_int_query(
            "page", default=1, maximum=100000
        )
        if page_error:
            return page_error
        limit, limit_error = parse_bounded_int_query(
            "limit", default=100, maximum=200
        )
        if limit_error:
            return limit_error
        total = len(filtered_leaderboard)
        leaderboard_page = filtered_leaderboard[(page - 1) * limit : page * limit]

        return jsonify(
            {
                "success": True,
                "message": "Leaderboard loaded successfully.",
                "data": {
                    "leaderboard": leaderboard_page,
                    "top_players": top_players,
                    "current_player": current_player,
                    "nearby_players": nearby_players,
                    "ranked_total": ranked_total,
                    "search": search,
                    "count": len(leaderboard_page),
                    **pagination_metadata(page=page, limit=limit, total=total),
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading leaderboard")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading leaderboard")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading leaderboard")
        return jsonify({"success": False, "message": "Could not load leaderboard."}), 500
@competitive_bp.get("/players/<player_id>")
def get_public_player_profile(player_id):
    try:
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        profile = build_public_player_profile(player_id, users, matches)

        return jsonify(
            {
                "success": True,
                "message": "Player profile loaded successfully.",
                "data": profile,
            }
        ), 200
    except ValueError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except LookupError as error:
        return jsonify({"success": False, "message": str(error)}), 404
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading player profile")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading player profile")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading player profile")
        return jsonify({"success": False, "message": "Could not load player profile."}), 500


@competitive_bp.get("/head-to-head/<player_a_id>/<player_b_id>")
def get_head_to_head(player_a_id, player_b_id):
    try:
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        comparison = build_head_to_head(player_a_id, player_b_id, users, matches)

        return jsonify(
            {
                "success": True,
                "message": "Head-to-head comparison loaded successfully.",
                "data": comparison,
            }
        ), 200
    except ValueError as error:
        return jsonify({"success": False, "message": str(error)}), 400
    except LookupError as error:
        return jsonify({"success": False, "message": str(error)}), 404
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading head-to-head comparison")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading head-to-head comparison")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading head-to-head comparison")
        return jsonify({"success": False, "message": "Could not load the head-to-head comparison."}), 500
