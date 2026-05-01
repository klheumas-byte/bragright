from datetime import datetime, timezone

from flask import Flask, jsonify
from pymongo.errors import PyMongoError
from werkzeug.exceptions import HTTPException

from .config import Config
from .db import describe_mongo_error, get_db, get_db_debug_snapshot, get_users_collection, init_db
from .extensions import init_extensions
from .routes.activity import activity_bp
from .routes.auth import auth_bp
from .routes.admin import admin_bp
from .routes.competitive import competitive_bp
from .routes.dashboard import dashboard_bp
from .routes.health import health_bp
from .routes.matches import matches_bp, upload_proof
from .routes.players import players_bp
from .routes.profile import profile_bp


def _validate_runtime_config(app):
    required_settings = ("MONGO_URI", "MONGO_DB_NAME")
    missing_settings = [name for name in required_settings if not app.config.get(name)]

    if not app.config.get("DEBUG") and not app.config.get("SECRET_KEY"):
        missing_settings.append("SECRET_KEY")

    if not app.config.get("DEBUG") and not app.config.get("FRONTEND_ORIGIN"):
        missing_settings.append("FRONTEND_ORIGIN")

    if missing_settings:
        raise RuntimeError(
            "Missing required environment variables: "
            + ", ".join(sorted(set(missing_settings)))
        )


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    _validate_runtime_config(app)

    init_extensions(app)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(activity_bp, url_prefix="/api/activity")
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
    app.register_blueprint(matches_bp, url_prefix="/api/matches")
    app.register_blueprint(players_bp, url_prefix="/api/players")
    app.register_blueprint(profile_bp, url_prefix="/api/profile")
    app.register_blueprint(competitive_bp, url_prefix="/api")
    app.add_url_rule("/api/upload", view_func=upload_proof, methods=["POST"], endpoint="upload_proof_alias")

    if app.config.get("DEBUG"):
        app.logger.info("MongoDB debug snapshot: %s", get_db_debug_snapshot(app.config))

    @app.get("/api")
    def api_index():
        return jsonify(
            {
                "success": True,
                "message": "BragRight API is running.",
                "routes": {
                    "health": "/api/health",
                    "test_db": "/api/test-db",
                    "register": "/api/auth/register",
                    "login": "/api/auth/login",
                    "me": "/api/auth/me",
                    "logout": "/api/auth/logout",
                    "my_activity": "/api/activity/me",
                    "admin_summary": "/api/admin/summary",
                    "admin_dashboard_summary": "/api/admin/dashboard/summary",
                    "admin_profile_me": "/api/admin/profile/me",
                    "admin_users": "/api/admin/users",
                    "admin_reset_password": "/api/admin/users/<id>/reset-password",
                    "admin_settings": "/api/admin/settings",
                    "admin_activity": "/api/admin/activity",
                    "admin_logins": "/api/admin/logins",
                    "admin_disputes": "/api/admin/disputes",
                    "admin_match_detail": "/api/admin/matches/<id>",
                    "profile_me": "/api/profile/me",
                    "profile_update": "/api/profile/update",
                    "profile_me_matches": "/api/profile/me/matches",
                    "players": "/api/players",
                    "leaderboard": "/api/leaderboard",
                    "matches": "/api/matches",
                    "upload": "/api/upload",
                },
            }
        ), 200

    @app.get("/api/test-db")
    @app.get("/test-db")
    def test_db():
        try:
            init_db(config=app.config, logger=app.logger, force_reconnect=True)
            db = get_db(config=app.config, logger=app.logger)
            db.command("ping")
            users = get_users_collection(config=app.config, logger=app.logger)
            users.estimated_document_count()

            return jsonify(
                {
                    "success": True,
                    "message": "MongoDB Atlas connection is working.",
                    "details": {
                        "database": db.name,
                        "users_collection": users.name,
                        "checked_at": datetime.now(timezone.utc).isoformat(),
                    },
                }
            ), 200
        except PyMongoError as error:
            app.logger.exception("MongoDB test route failed")
            return jsonify(
                {
                    "success": False,
                    "message": describe_mongo_error(error),
                    "debug": get_db_debug_snapshot(app.config) if app.config.get("DEBUG") else None,
                }
            ), 500
        except RuntimeError as error:
            app.logger.exception("MongoDB test route configuration failed")
            return jsonify(
                {
                    "success": False,
                    "message": str(error),
                    "debug": get_db_debug_snapshot(app.config) if app.config.get("DEBUG") else None,
                }
            ), 500
        except Exception:
            app.logger.exception("Unexpected error in test-db route")
            return jsonify({"success": False, "message": "Database test failed."}), 500

    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        return jsonify(
            {
                "success": False,
                "message": error.description,
            }
        ), error.code

    @app.errorhandler(Exception)
    def handle_unexpected_exception(error):
        app.logger.exception("Unhandled application error", exc_info=error)
        return jsonify(
            {
                "success": False,
                "message": "Internal server error.",
            }
        ), 500

    return app
