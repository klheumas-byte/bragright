PLAYER_ROLE = "player"
ADMIN_ROLE = "admin"
VALID_USER_ROLES = {PLAYER_ROLE, ADMIN_ROLE}


def _normalize_identity_list(raw_value):
    if not raw_value:
        return set()

    if isinstance(raw_value, (list, tuple, set)):
        values = raw_value
    else:
        values = str(raw_value).split(",")

    return {str(value).strip().lower() for value in values if str(value).strip()}


def _get_bootstrap_admin_emails(config):
    return _normalize_identity_list(config.get("ADMIN_EMAILS"))


def is_bootstrap_admin_email(email, config):
    normalized_email = str(email or "").strip().lower()
    return bool(normalized_email and normalized_email in _get_bootstrap_admin_emails(config))


def get_user_role(user, config):
    if not user:
        return PLAYER_ROLE

    user_email = str(user.get("email", "")).strip().lower()

    # Bootstrap admin emails should always resolve to admin during this phase,
    # even if the account was initially created as a normal player before the
    # persisted role was upgraded.
    if is_bootstrap_admin_email(user_email, config):
        return ADMIN_ROLE

    stored_role = str(user.get("role", "")).strip().lower()
    if stored_role in VALID_USER_ROLES:
        return stored_role

    return PLAYER_ROLE


def is_admin_user(user, config):
    return get_user_role(user, config) == ADMIN_ROLE
