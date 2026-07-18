from flask import Blueprint, current_app, jsonify, request
from pymongo.errors import PyMongoError

from ..db import describe_mongo_error, get_db_debug_snapshot
from ..services.api_security import (
    pagination_metadata,
    parse_bounded_int_query,
)
from ..services.activity_logger import get_activity_logs
from .auth import get_current_user_from_request, require_player, serialize_user


activity_bp = Blueprint("activity", __name__)
DEFAULT_ACTIVITY_LIMIT = 20
MAX_ACTIVITY_LIMIT = 100
PLAYER_ACTIVITY_CATEGORIES = {
    "account": {"login"},
    "profile": {"profile_updated"},
    "challenges": {
        "match_scheduled",
        "match_request_accepted",
        "match_request_declined",
        "match_cancelled",
    },
    "results": {"proof_uploaded", "result_submitted", "match_confirmed"},
    "disputes": {"match_disputed"},
}
PLAYER_ACTIVITY_ACTION_TYPES = set().union(*PLAYER_ACTIVITY_CATEGORIES.values())


def _parse_limit_arg(default_limit=DEFAULT_ACTIVITY_LIMIT, max_limit=MAX_ACTIVITY_LIMIT):
    return parse_bounded_int_query(
        "limit",
        default=default_limit,
        maximum=max_limit,
    )


@activity_bp.get("/me")
@require_player
def get_my_activity():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        serialized_user = serialize_user(user)
        limit, limit_error = _parse_limit_arg()
        if limit_error:
            return limit_error
        page, page_error = parse_bounded_int_query(
            "page", default=1, maximum=100000
        )
        if page_error:
            return page_error
        category = str(request.args.get("category") or "all").strip().lower()
        if category != "all" and category not in PLAYER_ACTIVITY_CATEGORIES:
            return jsonify({"success": False, "message": "category is invalid."}), 422
        logs, total = get_activity_logs(
            user_id=serialized_user["id"],
            action_types=(
                PLAYER_ACTIVITY_ACTION_TYPES
                if category == "all"
                else PLAYER_ACTIVITY_CATEGORIES[category]
            ),
            limit=limit,
            page=page,
            return_total=True,
        )

        return jsonify(
            {
                "success": True,
                "message": "Your activity loaded successfully.",
                "data": {
                    "logs": logs,
                    **pagination_metadata(page=page, limit=limit, total=total),
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
