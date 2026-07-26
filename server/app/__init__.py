import re
import time
import gzip
from uuid import uuid4

from flask import Flask, g, request
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.exceptions import HTTPException

from .config import Config
from .db import (
    ensure_database_indexes,
    init_db,
)
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
from .routes.payments import payments_bp
from .services.api_security import (
    ErrorCode,
    api_error,
    normalize_error_payload,
    sanitize_response_payload,
)
from .services.logging_config import configure_logging
from .services.rate_limiter import FixedWindowRateLimiter


REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


def _validate_runtime_config(app):
    is_production = bool(
        app.config.get("IS_PRODUCTION")
        or str(app.config.get("APP_ENV", "")).lower() == "production"
    )
    required_settings = ("MONGODB_URI", "MONGODB_DATABASE")
    if not app.config.get("MONGODB_URI") and app.config.get("MONGO_URI"):
        app.config["MONGODB_URI"] = app.config["MONGO_URI"]
    if not app.config.get("MONGODB_DATABASE") and app.config.get("MONGO_DB_NAME"):
        app.config["MONGODB_DATABASE"] = app.config["MONGO_DB_NAME"]
    missing_settings = [name for name in required_settings if not app.config.get(name)]

    if is_production and not app.config.get("SECRET_KEY"):
        missing_settings.append("SECRET_KEY")

    if is_production and not app.config.get("ALLOWED_ORIGINS"):
        missing_settings.append("ALLOWED_ORIGINS")

    if is_production and not app.config.get("JWT_ACCESS_SECRET"):
        missing_settings.append("JWT_ACCESS_SECRET")

    if missing_settings:
        raise RuntimeError(
            "Missing required environment variables: "
            + ", ".join(sorted(set(missing_settings)))
        )

    access_secret = str(app.config.get("JWT_ACCESS_SECRET") or "")
    flask_secret = str(app.config.get("SECRET_KEY") or "")
    unsafe_secret_markers = ("replace-with", "change-me", "your-secret", "placeholder")
    if len(access_secret) < 32 or (
        is_production
        and any(marker in access_secret.lower() for marker in unsafe_secret_markers)
    ):
        raise RuntimeError(
            "JWT_ACCESS_SECRET must be a non-placeholder secret of at least 32 characters."
        )
    if is_production and (
        len(flask_secret) < 32
        or any(marker in flask_secret.lower() for marker in unsafe_secret_markers)
    ):
        raise RuntimeError(
            "SECRET_KEY must be a non-placeholder secret of at least 32 characters."
        )

    same_site = str(app.config.get("AUTH_COOKIE_SAMESITE") or "").strip().title()
    if same_site not in {"Lax", "Strict", "None"}:
        raise RuntimeError("AUTH_COOKIE_SAMESITE must be Lax, Strict, or None.")
    app.config["AUTH_COOKIE_SAMESITE"] = same_site

    if same_site == "None" and not app.config.get("AUTH_COOKIE_SECURE"):
        raise RuntimeError("AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAMESITE=None.")

    allowed_origins = app.config.get("CORS_ORIGINS") or []
    if "*" in allowed_origins:
        raise RuntimeError("Credentialed CORS cannot use a wildcard frontend origin.")
    if app.config.get("UPLOAD_STORAGE_PROVIDER", "local") not in {"local"}:
        raise RuntimeError(
            "UPLOAD_STORAGE_PROVIDER is not supported by the configured application."
        )


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)
    _validate_runtime_config(app)
    configure_logging(app)

    if app.config.get("TRUST_PROXY"):
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=1,
            x_proto=1,
            x_host=1,
            x_port=1,
        )

    if app.config.get("INIT_DB_INDEXES_AT_STARTUP", False):
        init_db(config=app.config, logger=app.logger)
        ensure_database_indexes(config=app.config, logger=app.logger)

    init_extensions(app)
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(activity_bp, url_prefix="/api/activity")
    app.register_blueprint(health_bp)
    app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")
    app.register_blueprint(matches_bp, url_prefix="/api/matches")
    app.register_blueprint(players_bp, url_prefix="/api/players")
    app.register_blueprint(profile_bp, url_prefix="/api/profile")
    app.register_blueprint(competitive_bp, url_prefix="/api")
    app.register_blueprint(payments_bp, url_prefix="/api/payments")
    app.add_url_rule("/api/upload", view_func=upload_proof, methods=["POST"], endpoint="upload_proof_alias")
    app.extensions["rate_limiter"] = FixedWindowRateLimiter()

    rate_limited_endpoints = {
        "auth.register": ("auth", "RATE_LIMIT_AUTH"),
        "auth.login": ("auth", "RATE_LIMIT_AUTH"),
        "auth.change_password": ("auth", "RATE_LIMIT_AUTH"),
        "admin.reset_admin_user_password": (
            "admin_password_reset",
            "RATE_LIMIT_ADMIN_RESET",
        ),
        "matches.upload_proof": ("upload", "RATE_LIMIT_UPLOAD"),
        "upload_proof_alias": ("upload", "RATE_LIMIT_UPLOAD"),
        "matches.schedule_match": (
            "match_mutation",
            "RATE_LIMIT_MATCH_MUTATION",
        ),
        "matches.submit_match_result": (
            "match_mutation",
            "RATE_LIMIT_MATCH_MUTATION",
        ),
        "matches.dispute_match": (
            "match_mutation",
            "RATE_LIMIT_MATCH_MUTATION",
        ),
        "payments.record_payment": ("payment_mutation", "RATE_LIMIT_MATCH_MUTATION"),
        "payments.submit_remittance": ("payment_mutation", "RATE_LIMIT_MATCH_MUTATION"),
        "payments.review_remittance": ("payment_mutation", "RATE_LIMIT_MATCH_MUTATION"),
        "payments.reverse_payment": ("payment_mutation", "RATE_LIMIT_MATCH_MUTATION"),
        "payments.verify_payment": ("payment_mutation", "RATE_LIMIT_MATCH_MUTATION"),
        "payments.upload_payment_proof": ("upload", "RATE_LIMIT_UPLOAD"),
        "payments.override_subscription_access": ("payment_mutation", "RATE_LIMIT_MATCH_MUTATION"),
    }

    query_parameter_allowlist = {
        "competitive.get_leaderboard": {
            "page", "limit", "search", "player_id", "category", "scope",
            "competition_id", "game", "minimum_matches",
        },
        "competitive.get_player_statistics": {"scope"},
        "players.list_players": {"page", "limit", "search"},
        "activity.get_my_activity": {"page", "limit", "category"},
        "profile.get_my_profile_matches": {"page", "limit"},
        "matches.get_my_matches": {"page", "limit", "view"},
        "admin.get_admin_users": {"role", "status", "search", "page", "limit"},
        "admin.get_admin_activity": {
            "user",
            "role",
            "action_type",
            "start_date",
            "end_date",
            "limit",
            "page",
        },
        "admin.get_admin_logins": {
            "user",
            "role",
            "start_date",
            "end_date",
            "limit",
            "page",
        },
        "admin.get_admin_matches": {
            "status",
            "player",
            "date_from",
            "date_to",
            "limit",
            "page",
        },
        "admin.get_admin_disputes": {"page", "limit"},
        "payments.get_my_subscription": {"billing_month"},
        "payments.search_subscription_players": {"search", "billing_month", "subscription_status"},
        "payments.list_payments": {"billing_month", "payment_method", "status", "officer_id", "player"},
        "payments.payment_dashboard": {"billing_month", "officer_id", "payment_method", "payment_status", "subscription_status", "player"},
        "payments.list_remittances": {"status", "billing_month", "officer_id"},
    }

    @app.before_request
    def validate_query_parameters():
        supplied_request_id = request.headers.get("X-Request-ID", "").strip()
        g.request_id = (
            supplied_request_id
            if REQUEST_ID_PATTERN.fullmatch(supplied_request_id)
            else uuid4().hex
        )
        g.request_started_at = time.perf_counter()

        # CORS preflight requests describe the eventual request but do not
        # execute an application endpoint. Shared GET/POST paths can resolve
        # OPTIONS to the POST endpoint, whose query allowlist is intentionally
        # empty. Leave preflight validation to Flask-CORS and validate the
        # actual follow-up request against its correctly resolved endpoint.
        if request.method == "OPTIONS":
            return None

        rate_limit_config = rate_limited_endpoints.get(request.endpoint)
        if rate_limit_config:
            scope, setting_name = rate_limit_config
            allowed, retry_after = app.extensions["rate_limiter"].check(
                scope,
                request.remote_addr or "unknown",
                limit=int(app.config.get(setting_name, 10)),
                window_seconds=int(
                    app.config.get("RATE_LIMIT_WINDOW_SECONDS", 60)
                ),
            )
            if not allowed:
                app.logger.warning(
                    "rate_limit_exceeded",
                    extra={
                        "request_id": g.request_id,
                        "endpoint": request.endpoint,
                        "rate_limit_scope": scope,
                    },
                )
                response, status = api_error(
                    "Too many requests. Please wait before trying again.",
                    429,
                    ErrorCode.TOO_MANY_REQUESTS,
                )
                response.headers["Retry-After"] = str(retry_after)
                return response, status

        if request.is_json:
            maximum_json_bytes = (
                int(app.config.get("MAX_JSON_BODY_SIZE_KB", 256)) * 1024
            )
            if request.content_length and request.content_length > maximum_json_bytes:
                return api_error(
                    "The JSON request body is too large.",
                    413,
                    ErrorCode.PAYLOAD_TOO_LARGE,
                )

        allowed_parameters = query_parameter_allowlist.get(request.endpoint, set())
        unexpected_parameters = sorted(set(request.args) - allowed_parameters)
        if unexpected_parameters:
            return api_error(
                "The request contains unsupported query parameters.",
                422,
                ErrorCode.VALIDATION_ERROR,
                details={"parameters": unexpected_parameters},
            )

    @app.before_request
    def enforce_subscription_access():
        endpoint = request.endpoint or ""
        if (
            not endpoint
            or endpoint.startswith(("auth.", "health.", "payments.", "static"))
            or not request.path.startswith("/api/")
        ):
            return None

        from .routes.auth import get_current_user_from_request
        from .services.admin_access import get_user_role
        from .services.subscription_service import subscription_access

        user, error_response, status_code = get_current_user_from_request()
        if error_response:
            # Public routes and their own decorators retain their existing behavior.
            return None
        role = get_user_role(user, app.config)
        if role == "payment_officer":
            return api_error(
                "Payment Officers may only access authorized payment resources.",
                403,
                "insufficient_permissions",
            )
        if role != "player":
            return None
        access = subscription_access(app.config, user)
        if access["allowed"]:
            return None
        return api_error(
            "Your monthly subscription is required to access this feature.",
            403,
            "subscription_required",
            details={
                "status": access["status"],
                "payment_path": "/payments/status",
            },
        )

    @app.after_request
    def secure_api_response(response):
        if response.is_json:
            payload = response.get_json(silent=True)
            if payload is not None:
                if response.status_code >= 400:
                    payload = normalize_error_payload(payload, response.status_code)
                else:
                    payload = sanitize_response_payload(payload)
                response.set_data(app.json.dumps(payload))
                response.content_type = "application/json"

        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
        )
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        response.headers["X-Request-ID"] = getattr(g, "request_id", uuid4().hex)
        if app.config.get("IS_PRODUCTION") or str(
            app.config.get("APP_ENV", "")
        ).lower() == "production":
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        public_cache_endpoints = {
            "competitive.get_leaderboard",
            "competitive.get_public_player_profile",
            "competitive.get_head_to_head",
            "players.list_players",
        }
        if (
            request.method == "GET"
            and request.endpoint in public_cache_endpoints
            and "Authorization" not in request.headers
            and response.status_code == 200
        ):
            max_age = int(app.config.get("PUBLIC_CACHE_MAX_AGE_SECONDS", 15))
            response.headers["Cache-Control"] = (
                f"public, max-age={max_age}, stale-while-revalidate={max_age * 2}"
            )
        elif request.path.startswith("/api/") or request.path.startswith("/health"):
            response.headers["Cache-Control"] = "no-store"

        accepts_gzip = "gzip" in request.headers.get("Accept-Encoding", "").lower()
        compression_minimum = int(
            app.config.get("RESPONSE_COMPRESSION_MIN_BYTES", 1024)
        )
        if (
            accepts_gzip
            and response.status_code not in {204, 304}
            and not response.direct_passthrough
            and not response.headers.get("Content-Encoding")
            and response.content_type.startswith("application/json")
            and len(response.get_data()) >= compression_minimum
        ):
            response.set_data(gzip.compress(response.get_data(), compresslevel=5))
            response.headers["Content-Encoding"] = "gzip"
            response.headers["Vary"] = "Accept-Encoding"
            response.headers["Content-Length"] = str(len(response.get_data()))
        started_at = getattr(g, "request_started_at", None)
        duration_ms = (
            round((time.perf_counter() - started_at) * 1000, 2)
            if started_at is not None
            else None
        )
        is_slow_request = (
            duration_ms is not None
            and duration_ms
            >= int(app.config.get("SLOW_REQUEST_THRESHOLD_MS", 750))
        )
        log_method = app.logger.warning if is_slow_request else app.logger.info
        log_method(
            "slow_request" if is_slow_request else "request_complete",
            extra={
                "request_id": response.headers["X-Request-ID"],
                "method": request.method,
                "path": request.path,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
                "content_length": response.calculate_content_length(),
                "endpoint": request.endpoint,
            },
        )
        return response

    @app.errorhandler(HTTPException)
    def handle_http_exception(error):
        code = None
        if error.code == 404:
            code = ErrorCode.NOT_FOUND
        elif error.code == 413:
            code = ErrorCode.PAYLOAD_TOO_LARGE
        return api_error(
            error.description,
            error.code,
            code,
        )

    @app.errorhandler(Exception)
    def handle_unexpected_exception(error):
        app.logger.exception("Unhandled application error", exc_info=error)
        error_tracker = app.extensions.get("error_tracker")
        if callable(error_tracker):
            try:
                error_tracker(error, request_id=getattr(g, "request_id", None))
            except Exception:
                app.logger.exception("Error tracking hook failed")
        return api_error(
            "Internal server error.",
            500,
            ErrorCode.INTERNAL_ERROR,
        )

    app.logger.info(
        "application_started",
        extra={
            "endpoint": "startup",
        },
    )
    return app
