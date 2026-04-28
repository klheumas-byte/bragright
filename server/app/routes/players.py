from flask import Blueprint, current_app, jsonify
from pymongo import ASCENDING
from pymongo.errors import PyMongoError

from ..db import describe_mongo_error, get_db_debug_snapshot, get_users_collection
from .auth import serialize_user


players_bp = Blueprint("players", __name__)


@players_bp.get("")
def list_players():
    try:
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        player_documents = list(users.find({}, {"password_hash": 0}).sort("username", ASCENDING))
        players = [serialize_user(player) for player in player_documents]

        return jsonify(
            {
                "success": True,
                "message": "Players loaded successfully.",
                "data": {
                    "players": players,
                    "count": len(players),
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
