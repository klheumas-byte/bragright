from datetime import datetime, timedelta, timezone
from uuid import uuid4

import jwt
from flask import current_app


ACCESS_TOKEN_TYPE = "access"
JWT_ALGORITHM = "HS256"


class AccessTokenError(Exception):
    def __init__(self, message, code="invalid_token"):
        super().__init__(message)
        self.code = code


def create_access_token(user_id, session_id, now=None, lifetime=None):
    issued_at = now or datetime.now(timezone.utc)
    token_lifetime = lifetime or timedelta(
        minutes=current_app.config["JWT_ACCESS_TOKEN_MINUTES"]
    )
    payload = {
        "sub": str(user_id),
        "sid": str(session_id),
        "type": ACCESS_TOKEN_TYPE,
        "jti": uuid4().hex,
        "iat": issued_at,
        "exp": issued_at + token_lifetime,
        "iss": current_app.config["JWT_ISSUER"],
        "aud": current_app.config["JWT_AUDIENCE"],
    }
    return jwt.encode(
        payload,
        current_app.config["JWT_ACCESS_SECRET"],
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token):
    try:
        payload = jwt.decode(
            token,
            current_app.config["JWT_ACCESS_SECRET"],
            algorithms=[JWT_ALGORITHM],
            issuer=current_app.config["JWT_ISSUER"],
            audience=current_app.config["JWT_AUDIENCE"],
            options={
                "require": ["sub", "sid", "type", "jti", "iat", "exp", "iss", "aud"],
            },
        )
    except jwt.ExpiredSignatureError as error:
        raise AccessTokenError("Access token has expired.", "token_expired") from error
    except jwt.InvalidTokenError as error:
        raise AccessTokenError("Access token is invalid.", "invalid_token") from error

    if payload.get("type") != ACCESS_TOKEN_TYPE:
        raise AccessTokenError("Access token is invalid.", "invalid_token")

    if not str(payload.get("sub", "")).strip() or not str(payload.get("sid", "")).strip():
        raise AccessTokenError("Access token is invalid.", "invalid_token")

    return payload
