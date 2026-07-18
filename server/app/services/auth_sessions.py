import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from flask import current_app, request
from pymongo import ReturnDocument

from ..db import get_auth_sessions_collection


REFRESH_TOKEN_SEPARATOR = "."


class RefreshSessionError(Exception):
    def __init__(self, message, code="invalid_refresh_token", status_code=401):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def _now_utc():
    return datetime.now(timezone.utc)


def _ensure_aware(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _hash_token(raw_token):
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _build_raw_token(session_id):
    return f"{session_id}{REFRESH_TOKEN_SEPARATOR}{secrets.token_urlsafe(48)}"


def _extract_session_id(raw_token):
    if not raw_token or REFRESH_TOKEN_SEPARATOR not in raw_token:
        return ""
    session_id, secret = raw_token.split(REFRESH_TOKEN_SEPARATOR, 1)
    if not session_id or not secret:
        return ""
    return session_id


def _safe_request_metadata():
    user_agent = str(request.headers.get("User-Agent", ""))[:512]
    remote_address = str(request.remote_addr or "")[:64]
    return user_agent, remote_address


def create_refresh_session(user_id, family_id=None, now=None):
    created_at = now or _now_utc()
    expires_at = created_at + timedelta(days=current_app.config["REFRESH_TOKEN_DAYS"])
    session_id = uuid4().hex
    token_family_id = family_id or uuid4().hex
    raw_token = _build_raw_token(session_id)
    user_agent, ip_address = _safe_request_metadata()
    session_document = {
        "session_id": session_id,
        "family_id": token_family_id,
        "user_id": str(user_id),
        "token_hash": _hash_token(raw_token),
        "created_at": created_at,
        "expires_at": expires_at,
        "revoked_at": None,
        "replaced_by": None,
        "user_agent": user_agent,
        "ip_address": ip_address,
    }
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    sessions.insert_one(session_document)
    return session_document, raw_token


def get_active_session(session_id, user_id=None, now=None):
    query = {
        "session_id": str(session_id),
        "revoked_at": None,
        "expires_at": {"$gt": now or _now_utc()},
    }
    if user_id is not None:
        query["user_id"] = str(user_id)
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    return sessions.find_one(query)


def validate_refresh_session(raw_token, now=None):
    session_id = _extract_session_id(raw_token)
    if not session_id:
        raise RefreshSessionError("Refresh session is invalid.")

    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    session_document = sessions.find_one({"session_id": session_id})
    if not session_document:
        raise RefreshSessionError("Refresh session is invalid.")

    supplied_hash = _hash_token(raw_token)
    if not hmac.compare_digest(
        str(session_document.get("token_hash", "")),
        supplied_hash,
    ):
        raise RefreshSessionError("Refresh session is invalid.")

    if session_document.get("revoked_at") is not None:
        revoke_token_family(session_document["family_id"], now=now)
        raise RefreshSessionError(
            "Refresh session has already been used or revoked.",
            "refresh_token_reused",
        )

    expires_at = _ensure_aware(session_document.get("expires_at"))
    if not expires_at or expires_at <= (now or _now_utc()):
        revoke_session(session_document["session_id"], now=now)
        raise RefreshSessionError(
            "Refresh session has expired.",
            "refresh_token_expired",
        )

    return session_document


def rotate_refresh_session(raw_token, now=None):
    rotated_at = now or _now_utc()
    current_session = validate_refresh_session(raw_token, now=rotated_at)
    new_session, new_raw_token = create_refresh_session(
        current_session["user_id"],
        family_id=current_session["family_id"],
        now=rotated_at,
    )
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    updated_session = sessions.find_one_and_update(
        {
            "session_id": current_session["session_id"],
            "revoked_at": None,
            "token_hash": current_session["token_hash"],
        },
        {
            "$set": {
                "revoked_at": rotated_at,
                "replaced_by": new_session["session_id"],
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if not updated_session:
        sessions.delete_one({"session_id": new_session["session_id"]})
        revoke_token_family(current_session["family_id"], now=rotated_at)
        raise RefreshSessionError(
            "Refresh session has already been used or revoked.",
            "refresh_token_reused",
        )

    return new_session, new_raw_token


def revoke_session(session_id, now=None):
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    return sessions.update_one(
        {"session_id": str(session_id), "revoked_at": None},
        {"$set": {"revoked_at": now or _now_utc()}},
    )


def revoke_refresh_token(raw_token, now=None):
    session_id = _extract_session_id(raw_token)
    if not session_id:
        return None
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    session_document = sessions.find_one({"session_id": session_id})
    if not session_document:
        return None
    supplied_hash = _hash_token(raw_token)
    if not hmac.compare_digest(
        str(session_document.get("token_hash", "")),
        supplied_hash,
    ):
        return None
    return revoke_session(session_id, now=now)


def revoke_token_family(family_id, now=None):
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    return sessions.update_many(
        {"family_id": str(family_id), "revoked_at": None},
        {"$set": {"revoked_at": now or _now_utc()}},
    )


def revoke_user_sessions(user_id, now=None):
    sessions = get_auth_sessions_collection(
        config=current_app.config,
        logger=current_app.logger,
    )
    return sessions.update_many(
        {"user_id": str(user_id), "revoked_at": None},
        {"$set": {"revoked_at": now or _now_utc()}},
    )
