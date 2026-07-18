from flask import Blueprint, current_app, jsonify

from ..db import check_database_ready
from ..services.api_security import api_error

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
@health_bp.get("/api/health")
def health_check():
    return jsonify({"success": True, "data": {"status": "ok"}})


@health_bp.get("/health/ready")
@health_bp.get("/api/health/ready")
def readiness_check():
    try:
        ready = check_database_ready(
            config=current_app.config,
            logger=current_app.logger,
        )
    except Exception:
        current_app.logger.warning("Readiness database check failed.")
        ready = False
    if not ready:
        return api_error("Service is not ready.", 503, "NOT_READY")
    return jsonify({"success": True, "data": {"status": "ready"}})
