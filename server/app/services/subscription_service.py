from calendar import monthrange
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from ..config import DEFAULT_SUBSCRIPTION_MONTHLY_FEE_MINOR
from ..db import (
    get_billing_runs_collection,
    get_financial_audit_logs_collection,
    get_notifications_collection,
    get_payments_collection,
    get_remittances_collection,
    get_subscription_exemptions_collection,
    get_subscriptions_collection,
    get_users_collection,
)


ACTIVE_PAYMENT_STATUSES = {"recorded", "verified"}
SUBSCRIPTION_STATUSES = {
    "active",
    "payment_due",
    "grace_period",
    "pending_verification",
    "restricted",
    "expired",
    "exempted",
    "suspended",
}
PAYMENT_METHODS = {"cash", "mobile_money", "bank_deposit", "bank_transfer", "other"}
REMITTANCE_METHODS = {"mobile_money", "bank_deposit", "bank_transfer"}
SUPPORTED_PAY_AHEAD_MONTHS = (1, 2, 3, 6, 12)


class SubscriptionError(ValueError):
    def __init__(self, message, *, code="validation_error", status_code=422):
        super().__init__(message)
        self.code = code
        self.status_code = status_code


def utc_now():
    return datetime.now(timezone.utc)


def settings_from_config(config):
    return {
        "monthly_fee_minor": int(
            config.get(
                "SUBSCRIPTION_MONTHLY_FEE_MINOR",
                DEFAULT_SUBSCRIPTION_MONTHLY_FEE_MINOR,
            )
        ),
        "currency": str(config.get("SUBSCRIPTION_CURRENCY", "GHS")).upper(),
        "grace_days": int(config.get("SUBSCRIPTION_GRACE_DAYS", 7)),
        "payment_requires_verification": bool(
            config.get("PAYMENT_REQUIRES_SUPER_ADMIN_VERIFICATION", False)
        ),
        "payment_instructions": str(
            config.get(
                "SUBSCRIPTION_PAYMENT_INSTRUCTIONS",
                "Pay the monthly fee, keep the transaction reference, and submit it for verification or contact BragPay.",
            )
        ).strip(),
        "payment_destination": str(
            config.get("SUBSCRIPTION_PAYMENT_DESTINATION", "Contact BragPay for the current payment destination.")
        ).strip(),
        "support_contact": str(
            config.get("SUBSCRIPTION_SUPPORT_CONTACT", "Contact BragRight support or an administrator.")
        ).strip(),
    }


def normalize_billing_month(value):
    raw = str(value or "").strip()
    try:
        parsed = datetime.strptime(raw, "%Y-%m")
    except ValueError as error:
        raise SubscriptionError("Billing month must use YYYY-MM format.") from error
    if parsed.year < 2020 or parsed.year > 2100:
        raise SubscriptionError("Billing month is outside the supported range.")
    return raw


def current_billing_month(now=None):
    now = now or utc_now()
    return f"{now.year:04d}-{now.month:02d}"


def shift_billing_month(billing_month, offset):
    billing_month = normalize_billing_month(billing_month)
    year, month = (int(part) for part in billing_month.split("-"))
    absolute_month = year * 12 + month - 1 + int(offset)
    shifted_year, shifted_month = divmod(absolute_month, 12)
    return f"{shifted_year:04d}-{shifted_month + 1:02d}"


def _period_is_satisfied(config, player_id, billing_month):
    subscription = get_subscriptions_collection(config=config).find_one(
        {"player_id": str(player_id), "billing_month": billing_month}
    )
    if subscription and subscription.get("status") in {"active", "exempted"}:
        return True
    return get_payments_collection(config=config).find_one(
        {
            "player_id": str(player_id),
            "status": {"$in": list(ACTIVE_PAYMENT_STATUSES)},
            "$or": [
                {"billing_month": billing_month},
                {"covered_periods": billing_month},
            ],
        }
    ) is not None


def pay_ahead_plan(config, player_id, months, *, now=None):
    if isinstance(months, bool) or not isinstance(months, int) or months not in SUPPORTED_PAY_AHEAD_MONTHS:
        raise SubscriptionError(
            "Months must be one of 1, 2, 3, 6, or 12.",
            code="invalid_subscription_months",
        )
    settings = settings_from_config(config)
    if settings["currency"] != "GHS":
        raise SubscriptionError(
            "Pay Ahead supports GHS subscriptions only.",
            code="unsupported_currency",
            status_code=503,
        )
    candidate = current_billing_month(now)
    # Existing paid/exempted periods form the paid-through prefix. New
    # purchases always begin at the first genuinely unpaid period.
    for _ in range(240):
        if not _period_is_satisfied(config, player_id, candidate):
            break
        candidate = shift_billing_month(candidate, 1)
    else:
        raise SubscriptionError("No payable subscription period was found.")
    covered_periods = [shift_billing_month(candidate, offset) for offset in range(months)]
    if any(_period_is_satisfied(config, player_id, period) for period in covered_periods):
        raise SubscriptionError(
            "Existing subscription coverage is not consecutive. Contact support before paying ahead.",
            code="non_consecutive_subscription_coverage",
            status_code=409,
        )
    monthly_rate_minor = int(settings["monthly_fee_minor"])
    return {
        "months": months,
        "monthly_rate_minor": monthly_rate_minor,
        "total_minor": monthly_rate_minor * months,
        "currency": "GHS",
        "first_covered_period": covered_periods[0],
        "last_covered_period": covered_periods[-1],
        "covered_periods": covered_periods,
        "paid_through_period": shift_billing_month(candidate, -1)
        if candidate != current_billing_month(now)
        else None,
    }


def pay_ahead_options(config, player_id, *, now=None):
    """Build every supported preview from one authoritative allocation scan."""
    maximum_plan = pay_ahead_plan(
        config,
        player_id,
        max(SUPPORTED_PAY_AHEAD_MONTHS),
        now=now,
    )
    options = []
    for months in SUPPORTED_PAY_AHEAD_MONTHS:
        covered_periods = maximum_plan["covered_periods"][:months]
        options.append(
            {
                "months": months,
                "monthly_rate_minor": maximum_plan["monthly_rate_minor"],
                "total_minor": maximum_plan["monthly_rate_minor"] * months,
                "currency": maximum_plan["currency"],
                "first_covered_period": covered_periods[0],
                "last_covered_period": covered_periods[-1],
                "covered_periods": covered_periods,
                "paid_through_period": maximum_plan["paid_through_period"],
            }
        )
    return options


def month_dates(billing_month, grace_days=7):
    billing_month = normalize_billing_month(billing_month)
    year, month = (int(part) for part in billing_month.split("-"))
    due_date = datetime.combine(date(year, month, 1), time.min, tzinfo=timezone.utc)
    grace_day = min(max(int(grace_days), 1), monthrange(year, month)[1])
    grace_ends_at = datetime.combine(
        date(year, month, grace_day), time.max, tzinfo=timezone.utc
    )
    expires_at = datetime.combine(
        date(year, month, monthrange(year, month)[1]),
        time.max,
        tzinfo=timezone.utc,
    )
    return due_date, grace_ends_at, expires_at


def parse_amount_minor(value, field_name="Amount"):
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError) as error:
        raise SubscriptionError(f"{field_name} must be a valid amount.") from error
    if amount <= 0:
        raise SubscriptionError(f"{field_name} must be greater than zero.")
    return int(amount * 100)


def money(minor):
    return float((Decimal(int(minor or 0)) / 100).quantize(Decimal("0.01")))


def serialize_financial_document(document):
    if not document:
        return None
    result = {}
    for key, value in document.items():
        public_key = "id" if key == "_id" else key
        if key.endswith("_minor"):
            result[key.removesuffix("_minor")] = money(value)
            continue
        if isinstance(value, ObjectId):
            result[public_key] = str(value)
        elif isinstance(value, datetime):
            result[public_key] = value.isoformat()
        else:
            result[public_key] = value
    return result


def create_financial_audit(
    config,
    *,
    actor,
    action,
    target_user_id=None,
    amount_minor=None,
    billing_month=None,
    previous_state=None,
    new_state=None,
    reference=None,
    reason=None,
    metadata=None,
):
    now = utc_now()
    document = {
        "actor_id": str(actor.get("_id") or actor.get("id") or ""),
        "actor_name": actor.get("username") or actor.get("email") or "System",
        "actor_role": actor.get("role") or "system",
        "target_user_id": str(target_user_id or ""),
        "action": action,
        "amount_minor": amount_minor,
        "billing_month": billing_month,
        "previous_state": previous_state,
        "new_state": new_state,
        "reference": reference,
        "reason": reason,
        "metadata": metadata or {},
        "created_at": now,
    }
    return get_financial_audit_logs_collection(config=config).insert_one(document).inserted_id


def notify_user(config, user_id, event_type, message, metadata=None):
    if not user_id:
        return None
    return get_notifications_collection(config=config).insert_one(
        {
            "user_id": str(user_id),
            "event_type": event_type,
            "message": message,
            "metadata": metadata or {},
            "read_at": None,
            "created_at": utc_now(),
        }
    ).inserted_id


def get_or_create_subscription(config, player_id, billing_month, *, now=None):
    now = now or utc_now()
    billing_month = normalize_billing_month(billing_month)
    settings = settings_from_config(config)
    due_date, grace_ends_at, expires_at = month_dates(
        billing_month, settings["grace_days"]
    )
    initial_status = "grace_period" if due_date <= now <= grace_ends_at else (
        "restricted" if now > grace_ends_at else "payment_due"
    )
    subscriptions = get_subscriptions_collection(config=config)
    document = subscriptions.find_one_and_update(
        {"player_id": str(player_id), "billing_month": billing_month},
        {
            "$setOnInsert": {
                "player_id": str(player_id),
                "billing_month": billing_month,
                "amount_due_minor": settings["monthly_fee_minor"],
                "amount_paid_minor": 0,
                "currency": settings["currency"],
                "status": initial_status,
                "due_date": due_date,
                "grace_ends_at": grace_ends_at,
                "activated_at": None,
                "expires_at": expires_at,
                "payment_id": None,
                "exemption_id": None,
                "created_at": now,
                "updated_at": now,
            }
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return document


def valid_exemption(config, player_id, billing_month):
    return get_subscription_exemptions_collection(config=config).find_one(
        {
            "player_id": str(player_id),
            "billing_month": normalize_billing_month(billing_month),
            "status": "active",
        }
    )


def recalculate_subscription(config, player_id, billing_month, *, now=None):
    now = now or utc_now()
    subscription = get_or_create_subscription(config, player_id, billing_month, now=now)
    subscriptions = get_subscriptions_collection(config=config)
    exemption = valid_exemption(config, player_id, billing_month)
    recorded_payments = list(
        get_payments_collection(config=config).find(
            {
                "player_id": str(player_id),
                "status": {"$in": list(ACTIVE_PAYMENT_STATUSES)},
                "$or": [
                    {"billing_month": billing_month},
                    {"covered_periods": billing_month},
                ],
            }
        )
    )
    pending_submission = get_payments_collection(config=config).find_one(
        {
            "player_id": str(player_id),
            "billing_month": billing_month,
            "status": "pending_verification",
            "source": "player_submission",
        }
    )
    requires_verification = settings_from_config(config)["payment_requires_verification"]
    valid_payments = (
        [item for item in recorded_payments if item.get("status") == "verified"]
        if requires_verification
        else recorded_payments
    )
    amount_paid_minor = sum(
        int(item.get("monthly_rate_minor") or 0)
        if billing_month in (item.get("covered_periods") or [])
        else int(item.get("amount_minor") or 0)
        for item in valid_payments
    )
    latest_payment = max(valid_payments, key=lambda item: item.get("created_at") or now, default=None)
    override_status = subscription.get("override_status")
    if override_status == "suspended":
        status = "suspended"
    elif override_status == "active":
        status = "active"
    elif exemption:
        status = "exempted"
    elif amount_paid_minor >= int(subscription["amount_due_minor"]):
        status = "active"
    elif pending_submission or (requires_verification and recorded_payments):
        status = "pending_verification"
    elif now < subscription["due_date"]:
        status = "payment_due"
    elif now <= subscription["grace_ends_at"]:
        status = "grace_period"
    elif now > subscription["expires_at"]:
        status = "expired"
    else:
        status = "restricted"
    activated_at = now if status in {"active", "exempted"} else None
    updated = subscriptions.find_one_and_update(
        {"_id": subscription["_id"]},
        {
            "$set": {
                "amount_paid_minor": amount_paid_minor,
                "status": status,
                "activated_at": activated_at,
                "payment_id": str(latest_payment["_id"]) if latest_payment else None,
                "exemption_id": str(exemption["_id"]) if exemption else None,
                "updated_at": now,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    return updated


def has_security_restriction(user):
    if not user:
        return True
    return (
        str(user.get("status") or "active").strip().lower() != "active"
        or not user.get("is_active", True)
        or user.get("is_banned") is True
        or user.get("is_suspended") is True
    )


def subscription_access(config, user, *, now=None):
    if not user or str(user.get("role") or "player") != "player":
        return {"allowed": True, "status": "active", "reason": None}
    if has_security_restriction(user):
        return {"allowed": False, "status": "suspended", "reason": "security_restriction"}
    month = current_billing_month(now)
    subscription = get_subscriptions_collection(config=config).find_one(
        {"player_id": str(user["_id"]), "billing_month": month}
    )
    if not subscription:
        return {
            "allowed": False,
            "status": "payment_due",
            "reason": "subscription_required",
        }
    allowed = subscription.get("status") in {"active", "exempted"}
    return {
        "allowed": allowed,
        "status": subscription.get("status"),
        "reason": None if allowed else "subscription_required",
        "subscription": serialize_financial_document(subscription),
    }


def officer_ledger(config, officer_id, *, billing_month=None):
    payment_query = {
        "received_by": str(officer_id),
        "status": {"$in": list(ACTIVE_PAYMENT_STATUSES)},
    }
    if billing_month:
        payment_query["billing_month"] = normalize_billing_month(billing_month)
    payments = list(get_payments_collection(config=config).find(payment_query))
    total_collected = sum(int(item.get("amount_minor") or 0) for item in payments)
    remittance_query = {"payment_officer_id": str(officer_id)}
    if billing_month:
        remittance_query["billing_month"] = normalize_billing_month(billing_month)
    remittances = list(get_remittances_collection(config=config).find(remittance_query))
    total_submitted = sum(
        int(item.get("amount_minor") or 0)
        for item in remittances
        if item.get("status") in {"pending_verification", "verified"}
    )
    pending_remittance = sum(
        int(item.get("amount_minor") or 0)
        for item in remittances
        if item.get("status") == "pending_verification"
    )
    total_remitted = sum(
        int(item.get("amount_minor") or 0)
        for item in remittances
        if item.get("status") == "verified"
    )
    return {
        "total_collected_minor": total_collected,
        "payment_count": len(payments),
        "players_paid": len({item["player_id"] for item in payments}),
        "total_submitted_minor": total_submitted,
        "total_remitted_minor": total_remitted,
        "outstanding_balance_minor": max(total_collected - total_remitted, 0),
        "available_to_remit_minor": max(
            total_collected - total_remitted - pending_remittance,
            0,
        ),
    }


def serialize_ledger(ledger):
    return {
        "total_collected": money(ledger["total_collected_minor"]),
        "payment_count": ledger["payment_count"],
        "players_paid": ledger["players_paid"],
        "total_submitted": money(ledger["total_submitted_minor"]),
        "total_remitted": money(ledger["total_remitted_minor"]),
        "outstanding_balance": money(ledger["outstanding_balance_minor"]),
        "available_to_remit": money(ledger["available_to_remit_minor"]),
    }


def run_monthly_billing(config, actor, billing_month=None, *, dry_run=False, now=None):
    now = now or utc_now()
    billing_month = normalize_billing_month(billing_month or current_billing_month(now))
    users = get_users_collection(config=config)
    players = list(users.find({"$or": [{"role": "player"}, {"role": {"$exists": False}}]}))
    summary = {
        "billing_month": billing_month,
        "dry_run": bool(dry_run),
        "players_inspected": len(players),
        "subscriptions_created": 0,
        "accounts_activated": 0,
        "accounts_restricted": 0,
        "exemptions_skipped": 0,
        "errors": [],
    }
    subscriptions = get_subscriptions_collection(config=config)
    for player in players:
        player_id = str(player["_id"])
        try:
            existing = subscriptions.find_one(
                {"player_id": player_id, "billing_month": billing_month}
            )
            exemption = valid_exemption(config, player_id, billing_month)
            if exemption:
                summary["exemptions_skipped"] += 1
            if dry_run:
                if not existing:
                    summary["subscriptions_created"] += 1
                continue
            if not existing:
                get_or_create_subscription(config, player_id, billing_month, now=now)
                summary["subscriptions_created"] += 1
                create_financial_audit(
                    config,
                    actor=actor,
                    action="subscription_created",
                    target_user_id=player_id,
                    billing_month=billing_month,
                    previous_state=None,
                    new_state="payment_due",
                    metadata={"source": "monthly_billing"},
                )
                notify_user(
                    config,
                    player_id,
                    "payment_due",
                    f"Your {billing_month} subscription payment is due.",
                    {"billing_month": billing_month},
                )
            updated = recalculate_subscription(config, player_id, billing_month, now=now)
            previous_status = (existing or {}).get("status")
            if previous_status != updated["status"]:
                create_financial_audit(
                    config,
                    actor=actor,
                    action=(
                        "account_restricted"
                        if updated["status"] in {"restricted", "suspended"}
                        else "subscription_activated"
                        if updated["status"] in {"active", "exempted"}
                        else "subscription_status_changed"
                    ),
                    target_user_id=player_id,
                    billing_month=billing_month,
                    previous_state=previous_status,
                    new_state=updated["status"],
                    metadata={"source": "monthly_billing"},
                )
            if updated["status"] in {"active", "exempted"}:
                summary["accounts_activated"] += 1
            elif updated["status"] in {"restricted", "expired"}:
                summary["accounts_restricted"] += 1
                notify_user(
                    config,
                    player_id,
                    "account_restricted",
                    "Your subscription payment is overdue. Access is restricted until payment is recorded.",
                    {"billing_month": billing_month},
                )
        except Exception as error:  # continue safely and report per-player failures
            summary["errors"].append({"player_id": player_id, "message": str(error)})
    if not dry_run:
        run_key = f"{billing_month}:{now.date().isoformat()}"
        get_billing_runs_collection(config=config).update_one(
            {"run_key": run_key},
            {"$setOnInsert": {**summary, "run_key": run_key, "created_at": now}},
            upsert=True,
        )
        create_financial_audit(
            config,
            actor=actor,
            action="monthly_billing_executed",
            billing_month=billing_month,
            new_state=summary,
        )
    return summary
