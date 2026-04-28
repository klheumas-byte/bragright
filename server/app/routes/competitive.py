from flask import Blueprint, current_app, jsonify
from pymongo.errors import PyMongoError

from ..db import (
    describe_mongo_error,
    get_db_debug_snapshot,
    get_matches_collection,
    get_users_collection,
)
from ..services.competitive_service import build_head_to_head, build_leaderboard, build_public_player_profile


competitive_bp = Blueprint("competitive", __name__)


@competitive_bp.get("/leaderboard")
def get_leaderboard():
    try:
        users = get_users_collection(config=current_app.config, logger=current_app.logger)
        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        leaderboard = build_leaderboard(users, matches)

        return jsonify(
            {
                "success": True,
                "message": "Leaderboard loaded successfully.",
                "data": {
                    "leaderboard": leaderboard,
                    "count": len(leaderboard),
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
