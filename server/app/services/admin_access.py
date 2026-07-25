PLAYER_ROLE = "player"
ADMIN_ROLE = "admin"
SUPER_ADMIN_ROLE = "super_admin"
PAYMENT_OFFICER_ROLE = "payment_officer"
VALID_USER_ROLES = {
    PLAYER_ROLE,
    ADMIN_ROLE,
    SUPER_ADMIN_ROLE,
    PAYMENT_OFFICER_ROLE,
}
SUPER_ADMIN_ROLES = {ADMIN_ROLE, SUPER_ADMIN_ROLE}


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

    stored_role = str(user.get("role", "")).strip().lower()
    if stored_role in VALID_USER_ROLES:
        return stored_role

    return PLAYER_ROLE


def is_admin_user(user, config):
    return get_user_role(user, config) in SUPER_ADMIN_ROLES


def is_super_admin_user(user, config):
    return get_user_role(user, config) == SUPER_ADMIN_ROLE


def is_payment_officer_user(user, config):
    return get_user_role(user, config) == PAYMENT_OFFICER_ROLE
