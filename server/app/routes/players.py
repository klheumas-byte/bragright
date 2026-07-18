import re

from flask import Blueprint, current_app, jsonify, request
from pymongo import ASCENDING
from pymongo.errors import PyMongoError

from ..db import describe_mongo_error, get_db_debug_snapshot, get_users_collection
from ..services.api_security import pagination_metadata, parse_bounded_int_query
from ..services.dtos import player_public_dto


players_bp = Blueprint("players", __name__)


@players_bp.get("")
def list_players():
    try:
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
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
        query = {"role": "player", "status": {"$ne": "disabled"}}
        search = " ".join(str(request.args.get("search") or "").strip().split())
        if len(search) > 64:
            return jsonify(
                {
                    "success": False,
                    "message": "Player search must be 64 characters or fewer.",
                }
            ), 422
        if search:
            query["username"] = {
                "$regex": re.escape(search),
                "$options": "i",
            }
        total = users.count_documents(query)
        player_documents = list(
            users.find(
                query,
                {"username": 1, "profile_image": 1},
            )
            .sort("username", ASCENDING)
            .skip((page - 1) * limit)
            .limit(limit)
        )
        players = [player_public_dto(player) for player in player_documents]

        return jsonify(
            {
                "success": True,
                "message": "Players loaded successfully.",
                "data": {
                    "players": players,
                    "count": len(players),
                    "search": search,
                    **pagination_metadata(
                        page=page,
                        limit=limit,
                        total=total,
                    ),
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading players")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading players")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading players")
        return jsonify({"success": False, "message": "Could not load players."}), 500
