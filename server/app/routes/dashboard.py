from flask import Blueprint, current_app, jsonify
from pymongo.errors import PyMongoError

from ..db import (
    describe_mongo_error,
    get_db_debug_snapshot,
    get_matches_collection,
    get_notifications_collection,
)
from .auth import get_current_user_from_request, require_player
from ..services.admin_access import SUPER_ADMIN_ROLES, get_user_role
from ..services.dashboard_service import (
    get_dashboard_actions,
    get_dashboard_action_center,
    get_dashboard_notifications,
    get_dashboard_summary,
)


dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.get("/summary")
@require_player
def dashboard_summary():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        current_user = {
            "id": str(user["_id"]),
            "username": user.get("username", ""),
            "email": user.get("email", ""),
            "role": get_user_role(user, current_app.config),
        }
        summary = get_dashboard_summary(
            current_user,
            matches,
            is_admin=current_user["role"] in SUPER_ADMIN_ROLES,
        )

        return jsonify(
            {
                "success": True,
                "message": "Dashboard summary loaded successfully.",
                "data": summary,
            }
        )
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading dashboard summary")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading dashboard summary")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading dashboard summary")
        return jsonify({"success": False, "message": "Could not load the dashboard summary."}), 500


@dashboard_bp.get("/notifications")
@require_player
def dashboard_notifications():
    return _load_dashboard_notifications()


@dashboard_bp.get("/actions")
@require_player
def dashboard_actions():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        actions = get_dashboard_actions(
            {
                "id": str(user["_id"]),
                "username": user.get("username", ""),
                "email": user.get("email", ""),
                "role": get_user_role(user, current_app.config),
            },
            matches,
            is_admin=get_user_role(user, current_app.config) in SUPER_ADMIN_ROLES,
        )

        return jsonify(
            {
                "success": True,
                "message": "Dashboard actions loaded successfully.",
                "data": actions,
            }
        )
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading dashboard actions")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading dashboard actions")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading dashboard actions")
        return jsonify({"success": False, "message": "Could not load dashboard actions."}), 500


@dashboard_bp.get("/action-center")
@require_player
def dashboard_action_center():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        action_center = get_dashboard_action_center(
            {
                "id": str(user["_id"]),
                "username": user.get("username", ""),
                "email": user.get("email", ""),
                "role": get_user_role(user, current_app.config),
            },
            matches,
            is_admin=get_user_role(user, current_app.config) in SUPER_ADMIN_ROLES,
        )

        return jsonify(
            {
                "success": True,
                "message": "Dashboard action center loaded successfully.",
                "data": action_center,
            }
        )
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading dashboard action center")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading dashboard action center")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading dashboard action center")
        return jsonify({"success": False, "message": "Could not load the dashboard action center."}), 500


def _load_dashboard_notifications():
    try:
        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            return error_response, status_code

        matches = get_matches_collection(config=current_app.config, logger=current_app.logger)
        notifications = get_dashboard_notifications(
            {
                "id": str(user["_id"]),
                "username": user.get("username", ""),
                "email": user.get("email", ""),
                "role": get_user_role(user, current_app.config),
            },
            matches,
            is_admin=get_user_role(user, current_app.config) in SUPER_ADMIN_ROLES,
        )
        financial_items = list(
            get_notifications_collection(config=current_app.config, logger=current_app.logger)
            .find({"user_id": str(user["_id"])})
            .sort("created_at", -1)
            .limit(25)
        )
        if financial_items:
            notifications["items"] = [
                {
                    "id": str(item["_id"]),
                    "type": item.get("event_type"),
                    "message": item.get("message"),
                    "match_id": None,
                    "created_at": item.get("created_at").isoformat() if item.get("created_at") else None,
                    "action_label": "View payments",
                    "action_path": (
                        "/payments/dashboard"
                        if get_user_role(user, current_app.config) == "payment_officer"
                        else "/admin/payments"
                        if get_user_role(user, current_app.config) in SUPER_ADMIN_ROLES
                        else "/payments/status"
                    ),
                }
                for item in financial_items
            ] + notifications["items"]
            notifications["counts"]["financial"] = len(financial_items)

        return jsonify(
            {
                "success": True,
                "message": "Dashboard notifications loaded successfully.",
                "data": notifications,
            }
        )
    except PyMongoError as error:
        current_app.logger.exception("MongoDB error while loading dashboard notifications")
        return jsonify(
            {
                "success": False,
                "message": describe_mongo_error(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except RuntimeError as error:
        current_app.logger.exception("Configuration error while loading dashboard notifications")
        return jsonify(
            {
                "success": False,
                "message": str(error),
                "debug": get_db_debug_snapshot(current_app.config) if current_app.config.get("DEBUG") else None,
            }
        ), 500
    except Exception:
        current_app.logger.exception("Unexpected error while loading dashboard notifications")
        return jsonify({"success": False, "message": "Could not load dashboard notifications."}), 500
