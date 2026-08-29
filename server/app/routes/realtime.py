from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, jsonify, request

from .auth import get_current_user_from_request, require_authentication
from ..services.realtime_service import latest_event_cursor, visible_events


realtime_bp = Blueprint("realtime", __name__)


@realtime_bp.get("/events")
@require_authentication
def get_realtime_events():
    user, error_response, status_code = get_current_user_from_request()
    if error_response:
        return error_response, status_code
    raw_after = str(request.args.get("after") or "").strip()
    try:
        after_id = ObjectId(raw_after) if raw_after else None
    except InvalidId:
        return jsonify({"success": False, "message": "Realtime cursor is invalid."}), 400
    try:
        limit = max(1, min(int(request.args.get("limit", 100)), 200))
    except (TypeError, ValueError):
        return jsonify({"success": False, "message": "Realtime limit is invalid."}), 400
    if after_id is None:
        return jsonify({
            "success": True,
            "data": {"events": [], "cursor": latest_event_cursor(user) or str(ObjectId())},
        }), 200
    events = visible_events(user, after_id=after_id, limit=limit)
    return jsonify({
        "success": True,
        "data": {"events": events, "cursor": events[-1]["id"] if events else raw_after or None},
    }), 200
