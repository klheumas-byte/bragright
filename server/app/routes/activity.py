from flask import Blueprint, current_app, jsonify, request
from pymongo.errors import PyMongoError

from ..db import describe_mongo_error, get_db_debug_snapshot
from ..services.activity_logger import get_activity_logs
from .auth import get_current_user_from_request, serialize_user


activity_bp = Blueprint("activity", __name__)
DEFAULT_ACTIVITY_LIMIT = 20
MAX_ACTIVITY_LIMIT = 100


def _parse_limit_arg(default_limit=DEFAULT_ACTIVITY_LIMIT, max_limit=MAX_ACTIVITY_LIMIT):
    raw_value = str(request.args.get("limit", "")).strip()
    if not raw_value:
        return default_limit

    try:
        parsed_limit = int(raw_value)
    except ValueError:
        return default_limit

    return max(1, min(parsed_limit, max_limit))


@activity_bp.get("/me")
def get_my_activity():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        serialized_user = serialize_user(user)
        logs = get_activity_logs(user_id=serialized_user["id"], limit=_parse_limit_arg())

        return jsonify(
            {
                "success": True,
                "message": "Your activity loaded successfully.",
                "data": {
                    "logs": logs,
                },
            }
        ), 200
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading user activity")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading user activity")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading user activity")
        return jsonify({"success": False, "message": "Could not load your activity."}), 500
