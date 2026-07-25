from flask import current_app

from .admin_access import SUPER_ADMIN_ROLES, get_user_role


def _public_id(document):
    return str(document.get("_id", ""))


def _serialize_datetime(value):
    return value.isoformat() if value else None


def player_public_dto(user_document):
    return {
        "id": _public_id(user_document),
        "username": user_document.get("username", ""),
        "profile_image": user_document.get("profile_image") or "",
    }


def player_private_dto(user_document):
    role = get_user_role(user_document, current_app.config)
    return {
        **player_public_dto(user_document),
        "email": user_document.get("email", ""),
        "role": role,
        "status": str(user_document.get("status") or "active").lower(),
        "created_at": _serialize_datetime(user_document.get("created_at")),
    }


def admin_user_dto(user_document):
    role = get_user_role(user_document, current_app.config)
    return {
        "id": _public_id(user_document),
        "username": user_document.get("username", ""),
        "email": user_document.get("email", ""),
        "profile_image": user_document.get("profile_image") or "",
        "role": role,
        "status": str(user_document.get("status") or "active").lower(),
        "created_at": _serialize_datetime(user_document.get("created_at")),
    }


def authentication_user_dto(user_document):
    dto = player_private_dto(user_document)
    dto["role"] = get_user_role(user_document, current_app.config)
    dto["must_change_password"] = bool(user_document.get("must_change_password", False))
    if dto["role"] == "player":
        from .subscription_service import subscription_access

        access = subscription_access(current_app.config, user_document)
        dto["subscription_status"] = access["status"]
        dto["subscription_access"] = access["allowed"]
    return dto


def is_admin_dto(user_document):
    return get_user_role(user_document, current_app.config) in SUPER_ADMIN_ROLES
