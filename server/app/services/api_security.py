from copy import deepcopy
from datetime import datetime
from enum import StrEnum
import math

from flask import g, has_request_context, jsonify, request


class ErrorCode(StrEnum):
    BAD_REQUEST = "BAD_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    CONFLICT = "CONFLICT"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE"
    TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS"


STATUS_ERROR_CODES = {
    400: ErrorCode.BAD_REQUEST,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    409: ErrorCode.CONFLICT,
    422: ErrorCode.VALIDATION_ERROR,
    413: ErrorCode.PAYLOAD_TOO_LARGE,
    429: ErrorCode.TOO_MANY_REQUESTS,
    500: ErrorCode.INTERNAL_ERROR,
}

SENSITIVE_RESPONSE_FIELDS = {
    "password",
    "temporary_password",
    "new_password",
    "password_hash",
    "refresh_token",
    "token_hash",
    "jwt_access_secret",
    "jwt_secret",
    "secret_key",
    "is_admin",
    "permissions",
    "internal_permissions",
    "last_login",
    "last_login_at",
    "last_login_user_agent",
    "device_info",
    "ip_address",
    "debug",
    "database",
    "mongo_uri",
    "mongo_db_name",
}


def api_error(message, status_code=400, code=None, *, details=None):
    normalized_code = str(
        code or STATUS_ERROR_CODES.get(status_code, ErrorCode.BAD_REQUEST)
    ).upper()
    error = {
        "code": normalized_code,
        "message": str(message),
    }
    if details:
        error["details"] = sanitize_response_payload(details)
    payload = {"success": False, "error": error}
    if has_request_context() and getattr(g, "request_id", None):
        payload["request_id"] = g.request_id
    return jsonify(payload), status_code


def sanitize_response_payload(value):
    if isinstance(value, dict):
        return {
            key: sanitize_response_payload(item)
            for key, item in value.items()
            if str(key).lower() not in SENSITIVE_RESPONSE_FIELDS
        }
    if isinstance(value, list):
        return [sanitize_response_payload(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_response_payload(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    return deepcopy(value)


def normalize_error_payload(payload, status_code):
    if not isinstance(payload, dict) or payload.get("success") is not False:
        return sanitize_response_payload(payload)

    if status_code == 500:
        normalized = {
            "success": False,
            "error": {
                "code": str(ErrorCode.INTERNAL_ERROR),
                "message": "Internal server error.",
            },
        }
        if has_request_context() and getattr(g, "request_id", None):
            normalized["request_id"] = g.request_id
        return normalized

    existing_error = payload.get("error")
    if isinstance(existing_error, dict):
        normalized = sanitize_response_payload(
            {
                "success": False,
                "error": {
                    "code": str(
                        existing_error.get("code")
                        or STATUS_ERROR_CODES.get(status_code, ErrorCode.BAD_REQUEST)
                    ).upper(),
                    "message": existing_error.get("message") or "Request failed.",
                    **(
                        {"details": existing_error["details"]}
                        if existing_error.get("details")
                        else {}
                    ),
                },
            }
        )
        if has_request_context() and getattr(g, "request_id", None):
            normalized["request_id"] = g.request_id
        return normalized

    code = payload.get("auth_error") or STATUS_ERROR_CODES.get(
        status_code,
        ErrorCode.BAD_REQUEST,
    )
    normalized = {
        "success": False,
        "error": {
            "code": str(code).upper(),
            "message": str(payload.get("message") or "Request failed."),
        },
    }
    if has_request_context() and getattr(g, "request_id", None):
        normalized["request_id"] = g.request_id
    return normalized


def get_json_object(*, required=True, allowed_fields=None):
    payload = request.get_json(silent=True)
    if payload is None:
        if required:
            return None, api_error(
                "A JSON request body is required.",
                400,
                ErrorCode.BAD_REQUEST,
            )
        payload = {}
    if not isinstance(payload, dict):
        return None, api_error(
            "The JSON request body must be an object.",
            400,
            ErrorCode.BAD_REQUEST,
        )

    if allowed_fields is not None:
        unexpected_fields = sorted(set(payload) - set(allowed_fields))
        if unexpected_fields:
            return None, api_error(
                "The request contains unsupported fields.",
                422,
                ErrorCode.VALIDATION_ERROR,
                details={"fields": unexpected_fields},
            )
    return payload, None


def parse_bounded_int_query(name, *, default, minimum=1, maximum=100):
    raw_value = request.args.get(name)
    if raw_value is None or str(raw_value).strip() == "":
        return default, None
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return None, api_error(
            f"{name} must be a whole number.",
            422,
            ErrorCode.VALIDATION_ERROR,
        )
    if value < minimum or value > maximum:
        return None, api_error(
            f"{name} must be between {minimum} and {maximum}.",
            422,
            ErrorCode.VALIDATION_ERROR,
        )
    return value, None


def pagination_metadata(*, page, limit, total):
    pages = math.ceil(total / limit) if total else 0
    return {
        "page": page,
        "limit": limit,
        "total": total,
        "pages": pages,
        "has_next": page < pages,
        "has_previous": page > 1 and pages > 0,
    }
