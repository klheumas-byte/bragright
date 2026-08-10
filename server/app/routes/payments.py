import hashlib
import hmac
import re
from uuid import uuid4
from io import BytesIO
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, g, jsonify, request, send_file
from pymongo import DESCENDING
from pymongo.errors import DuplicateKeyError, PyMongoError

from ..db import (
    get_financial_audit_logs_collection,
    get_notifications_collection,
    get_payments_collection,
    get_proof_uploads_collection,
    get_remittances_collection,
    get_subscription_exemptions_collection,
    get_subscriptions_collection,
    get_users_collection,
)
from ..services.admin_access import (
    ADMIN_ROLE,
    PAYMENT_OFFICER_ROLE,
    SUPER_ADMIN_ROLE,
    SUPER_ADMIN_ROLES,
    get_user_role,
)
from ..services.api_security import get_json_object
from ..services.subscription_service import (
    PAYMENT_METHODS,
    REMITTANCE_METHODS,
    SUPPORTED_PAY_AHEAD_MONTHS,
    SubscriptionError,
    create_financial_audit,
    current_billing_month,
    get_or_create_subscription,
    has_security_restriction,
    money,
    normalize_billing_month,
    notify_user,
    officer_ledger,
    parse_amount_minor,
    pay_ahead_options,
    pay_ahead_plan,
    recalculate_subscription,
    run_monthly_billing,
    serialize_financial_document,
    serialize_ledger,
    settings_from_config,
    subscription_access,
    utc_now,
)
from ..services.paystack_service import (
    PaystackError,
    initialize_transaction,
    verify_transaction,
)
from ..services.upload_storage import get_upload_storage
from .matches import _normalize_proof_filename, _validate_proof_image
from .auth import require_authentication, require_role


payments_bp = Blueprint("payments", __name__)
FINANCIAL_ROLES = (PAYMENT_OFFICER_ROLE, ADMIN_ROLE, SUPER_ADMIN_ROLE)
REFERENCE_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/ -]{1,99}$")


def _error(message, status=422, code="validation_error"):
    return jsonify(
        {"success": False, "message": message, "error": {"code": code, "message": message}}
    ), status


def _handle_subscription_error(error):
    return _error(str(error), error.status_code, error.code)


@payments_bp.errorhandler(SubscriptionError)
def handle_uncaught_subscription_error(error):
    return _handle_subscription_error(error)


def _current_actor():
    user = g.current_user
    return {
        "id": str(user["_id"]),
        "_id": str(user["_id"]),
        "username": user.get("username"),
        "email": user.get("email"),
        "role": get_user_role(user, current_app.config),
    }


def _load_player(player_id):
    try:
        object_id = ObjectId(str(player_id))
    except (InvalidId, TypeError):
        raise SubscriptionError("Player ID is invalid.")
    player = get_users_collection(config=current_app.config).find_one(
        {"_id": object_id, "$or": [{"role": "player"}, {"role": {"$exists": False}}]}
    )
    if not player:
        raise SubscriptionError("Player was not found.", code="not_found", status_code=404)
    return player


def _validated_reference(value, *, required=False):
    reference = str(value or "").strip()
    if required and not reference:
        raise SubscriptionError("A transaction or receipt reference is required.")
    if reference and not REFERENCE_PATTERN.fullmatch(reference):
        raise SubscriptionError(
            "Reference must be 2–100 characters using letters, numbers, spaces, or ._:/-."
        )
    return reference


def _parse_date(value, field_name):
    if not value:
        return utc_now()
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as error:
        raise SubscriptionError(f"{field_name} must be a valid ISO date.") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _owned_proof(reference, actor_id):
    if not reference:
        return None
    prefix = "/api/payments/proof/"
    if not str(reference).startswith(prefix):
        raise SubscriptionError("Proof attachment reference is invalid.")
    filename = _normalize_proof_filename(str(reference)[len(prefix):])
    upload = (
        get_proof_uploads_collection(config=current_app.config).find_one(
            {"filename": filename, "owner_id": str(actor_id), "purpose": "financial"}
        )
        if filename
        else None
    )
    if not upload:
        raise SubscriptionError(
            "Proof attachment was not found or is not owned by this operator.",
            code="invalid_proof_ownership",
            status_code=403,
        )
    if upload.get("financial_record_id"):
        raise SubscriptionError("Proof attachment is already linked to another financial record.", status_code=409)
    return upload


@payments_bp.post("/upload-proof")
@require_role("player", *FINANCIAL_ROLES)
def upload_payment_proof():
    uploaded_file = request.files.get("proof_image")
    validated, validation_error = _validate_proof_image(uploaded_file)
    if validation_error:
        return _error(validation_error, 400, "invalid_attachment")
    actor = _current_actor()
    storage = get_upload_storage()
    provider_key = f"financial-proofs/{validated['filename']}"
    storage.save(provider_key, validated["content"])
    try:
        get_proof_uploads_collection(config=current_app.config).insert_one(
            {
                "filename": validated["filename"],
                "owner_id": actor["id"],
                "purpose": "financial",
                "financial_record_id": None,
                "file_type": validated["file_type"],
                "content_type": validated["content_type"],
                "size": validated["size"],
                "provider": storage.provider_name,
                "provider_key": provider_key,
                "created_at": utc_now(),
            }
        )
    except Exception:
        storage.delete(provider_key)
        raise
    return jsonify(
        {
            "success": True,
            "message": "Financial proof uploaded securely.",
            "data": {"proof": f"/api/payments/proof/{validated['filename']}"},
        }
    ), 201


@payments_bp.get("/proof/<filename>")
@require_role("player", *FINANCIAL_ROLES)
def get_payment_proof(filename):
    safe_filename = _normalize_proof_filename(filename)
    upload = (
        get_proof_uploads_collection(config=current_app.config).find_one(
            {"filename": safe_filename, "purpose": "financial"}
        )
        if safe_filename
        else None
    )
    if not upload:
        return _error("Financial proof was not found.", 404, "not_found")
    actor = _current_actor()
    if actor["role"] == "player" and upload.get("owner_id") != actor["id"]:
        return _error("You cannot view another player's proof.", 403, "insufficient_permissions")
    if actor["role"] == PAYMENT_OFFICER_ROLE and upload.get("owner_id") != actor["id"]:
        linked_payment = get_payments_collection(config=current_app.config).find_one(
            {
                "_id": ObjectId(upload["financial_record_id"])
                if ObjectId.is_valid(str(upload.get("financial_record_id") or ""))
                else None,
                "source": "player_submission",
            }
        )
        if not linked_payment:
            return _error("You cannot view another officer's private proof.", 403, "insufficient_permissions")
    content = get_upload_storage().read(upload["provider_key"])
    return send_file(
        BytesIO(content),
        mimetype=upload.get("content_type") or "application/octet-stream",
        download_name=safe_filename,
        as_attachment=False,
        max_age=0,
    )


@payments_bp.get("/settings")
@require_authentication
def get_payment_settings():
    settings = settings_from_config(current_app.config)
    return jsonify(
        {
            "success": True,
            "data": {
                "monthly_fee": money(settings["monthly_fee_minor"]),
                "currency": settings["currency"],
                "grace_days": settings["grace_days"],
                "payment_requires_verification": settings["payment_requires_verification"],
                "instructions": settings["payment_instructions"],
                "destination": settings["payment_destination"],
                "support_contact": settings["support_contact"],
            },
        }
    )


def _paystack_error(error):
    return _error(str(error), error.status_code, error.code)


def _provider_paid_at(value, fallback):
    if not value:
        return fallback
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return fallback
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _ensure_paystack_periods_are_available(payment):
    if payment.get("status") == "verified":
        return
    payments = get_payments_collection(config=current_app.config)
    subscriptions = get_subscriptions_collection(config=current_app.config)
    for period in payment.get("covered_periods") or [payment["billing_month"]]:
        conflicting_payment = payments.find_one(
            {
                "_id": {"$ne": payment["_id"]},
                "player_id": payment["player_id"],
                "status": {"$in": ["recorded", "verified"]},
                "$or": [{"billing_month": period}, {"covered_periods": period}],
            }
        )
        subscription = subscriptions.find_one(
            {"player_id": payment["player_id"], "billing_month": period}
        )
        linked_to_this_payment = str((subscription or {}).get("payment_id") or "") == str(payment["_id"])
        already_satisfied = (
            subscription
            and subscription.get("status") in {"active", "exempted"}
            and not linked_to_this_payment
        )
        if conflicting_payment or already_satisfied:
            raise PaystackError(
                f"Subscription period {period} is already fulfilled.",
                code="subscription_period_already_fulfilled",
                status_code=409,
            )


def _fulfill_verified_paystack_payment(payment, provider_data):
    reference = str(provider_data.get("reference") or "")
    if reference != payment.get("paystack_reference") or reference != payment.get("reference"):
        raise PaystackError("Paystack verification returned a different reference.", code="reference_mismatch")
    try:
        provider_amount = int(provider_data.get("amount"))
    except (TypeError, ValueError) as error:
        raise PaystackError("Paystack verification returned an invalid amount.", code="amount_mismatch") from error
    if provider_amount != int(payment.get("amount_minor") or 0):
        raise PaystackError("Paystack verification amount does not match the payment.", code="amount_mismatch")
    if str(provider_data.get("currency") or "").upper() != "GHS":
        raise PaystackError("Paystack verification currency does not match GHS.", code="currency_mismatch")

    provider_status = str(provider_data.get("status") or "").lower()
    payments = get_payments_collection(config=current_app.config)
    now = utc_now()
    if provider_status != "success":
        update = {"provider_status": provider_status or "unknown", "updated_at": now}
        if provider_status in {"failed", "abandoned", "reversed"}:
            update["status"] = "failed"
        payments.update_one({"_id": payment["_id"], "fulfilled_at": None}, {"$set": update})
        return payments.find_one({"_id": payment["_id"]}), False

    if payment.get("fulfilled_at"):
        return payment, False
    _ensure_paystack_periods_are_available(payment)
    paid_at = _provider_paid_at(provider_data.get("paid_at"), now)
    covered_periods = payment.get("covered_periods") or [payment["billing_month"]]
    for period in covered_periods:
        get_or_create_subscription(current_app.config, payment["player_id"], period, now=now)
    payments.update_one(
        {
            "_id": payment["_id"],
            "fulfilled_at": None,
            "status": {"$nin": ["reversed"]},
        },
        {
            "$set": {
                "status": "verified",
                "provider_status": "success",
                "paystack_transaction_id": provider_data.get("id"),
                "payment_date": paid_at,
                "paid_at": paid_at,
                "verified_at": now,
                "updated_at": now,
            }
        },
    )
    # Recalculation is itself idempotent. Running it before setting fulfilled_at
    # also makes a retry repair a process interrupted between these two writes.
    for period in covered_periods:
        recalculate_subscription(
            current_app.config,
            payment["player_id"],
            period,
            now=now,
        )
    fulfilled = payments.update_one(
        {"_id": payment["_id"], "fulfilled_at": None, "status": "verified"},
        {"$set": {
            "fulfilled_at": now,
            "fulfilled_periods": covered_periods,
            "paid_through_period": covered_periods[-1],
            "updated_at": now,
        }},
    ).modified_count == 1
    updated = payments.find_one({"_id": payment["_id"]})
    if fulfilled:
        actor = {"id": "paystack", "username": "Paystack", "role": "system"}
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="paystack_payment_verified",
            target_user_id=payment["player_id"],
            amount_minor=payment["amount_minor"],
            billing_month=payment["billing_month"],
            previous_state=payment.get("status"),
            new_state="verified",
            reference=reference,
            metadata={"payment_id": str(payment["_id"]), "provider": "paystack"},
        )
        notify_user(
            current_app.config,
            payment["player_id"],
            "payment_verified",
            f"Your Paystack payment for {payment['billing_month']} was verified.",
            {"payment_id": str(payment["_id"]), "billing_month": payment["billing_month"]},
        )
    return updated, fulfilled


def _rotate_failed_paystack_transaction(payment):
    payments = get_payments_collection(config=current_app.config)
    previous_reference = payment["paystack_reference"]
    reference = f"BR-PSTK-{uuid4().hex}"
    payments.update_one(
        {"_id": payment["_id"], "fulfilled_at": None},
        {
            "$set": {
                "reference": reference,
                "paystack_reference": reference,
                "status": "paystack_pending",
                "provider_status": "pending",
                "paid_at": None,
                "verified_at": None,
                "updated_at": utc_now(),
            },
            "$unset": {
                "authorization_url": "",
                "provider_access_code": "",
                "paystack_transaction_id": "",
                "initialization_outcome_unknown": "",
                "provider_http_status": "",
            },
            "$addToSet": {"previous_paystack_references": previous_reference},
        },
    )
    return payments.find_one({"_id": payment["_id"]})


@payments_bp.post("/paystack/initialize")
@require_role("player")
def initialize_paystack_payment():
    payload, body_error = get_json_object(allowed_fields={"payment_type", "months"})
    if body_error:
        return body_error
    payment_type = str(payload.get("payment_type") or "").strip().lower()
    if payment_type != "monthly_subscription":
        return _error("Payment type is invalid.", 422, "invalid_payment_type")
    months = payload.get("months", 1)
    if isinstance(months, bool) or not isinstance(months, int) or months not in SUPPORTED_PAY_AHEAD_MONTHS:
        return _error(
            "Months must be one of 1, 2, 3, 6, or 12.",
            422,
            "invalid_subscription_months",
        )

    actor = _current_actor()
    payments = get_payments_collection(config=current_app.config)
    open_payment = payments.find_one({
        "player_id": actor["id"],
        "source": "paystack",
        "fulfilled_at": None,
        "status": {"$in": ["paystack_pending", "paystack_initialized", "initialization_failed"]},
    })
    if open_payment and open_payment.get("status") == "paystack_initialized":
        try:
            provider_data = verify_transaction(
                current_app.config, open_payment["paystack_reference"]
            )
            reconciled_payment, _ = _fulfill_verified_paystack_payment(
                open_payment, provider_data
            )
        except PaystackError as error:
            # Never return a cached checkout URL when its provider state cannot
            # be confirmed. This avoids reopening a possibly completed link.
            return _paystack_error(error)
        provider_status = str(provider_data.get("status") or "").lower()
        if provider_status == "success":
            open_payment = None
        elif provider_status in {"pending", "ongoing", "processing", "queued"}:
            if int(open_payment.get("months") or 1) != months:
                return _error(
                    "A different Paystack checkout is already open. Complete it before changing the number of months.",
                    409,
                    "paystack_checkout_in_progress",
                )
            return jsonify({
                "success": True,
                "data": {
                    "authorization_url": open_payment["authorization_url"],
                    "reference": open_payment["reference"],
                    "payment": serialize_financial_document(reconciled_payment),
                },
            })
        else:
            open_payment = _rotate_failed_paystack_transaction(reconciled_payment)
    if (
        open_payment
        and open_payment.get("status") == "initialization_failed"
        and open_payment.get("initialization_outcome_unknown")
    ):
        try:
            provider_data = verify_transaction(
                current_app.config, open_payment["paystack_reference"]
            )
        except PaystackError as error:
            if error.provider_status == 404:
                open_payment = _rotate_failed_paystack_transaction(open_payment)
            else:
                return _paystack_error(error)
        else:
            provider_status = str(provider_data.get("status") or "").lower()
            reconciled_payment, _ = _fulfill_verified_paystack_payment(
                open_payment, provider_data
            )
            if provider_status == "success":
                open_payment = None
            elif provider_status in {"failed", "abandoned", "reversed"}:
                open_payment = _rotate_failed_paystack_transaction(reconciled_payment)
            else:
                return _error(
                    "Paystack is still processing the previous transaction initialization.",
                    409,
                    "paystack_initialization_pending",
                )
    if open_payment and int(open_payment.get("months") or 1) != months:
        return _error(
            "A different Paystack checkout is already open. Complete it before changing the number of months.",
            409,
            "paystack_checkout_in_progress",
        )

    try:
        plan = pay_ahead_plan(current_app.config, actor["id"], months)
    except SubscriptionError as error:
        return _handle_subscription_error(error)
    month = plan["first_covered_period"]
    subscription = get_or_create_subscription(current_app.config, actor["id"], month)
    amount_minor = plan["total_minor"]
    deduplication_key = (
        f"paystack:{actor['id']}:{plan['first_covered_period']}:"
        f"{plan['last_covered_period']}:monthly_subscription"
    )
    payment = open_payment or payments.find_one({"deduplication_key": deduplication_key})
    if payment and payment.get("status") == "failed" and not payment.get("fulfilled_at"):
        payment = _rotate_failed_paystack_transaction(payment)

    now = utc_now()
    if not payment:
        reference = f"BR-PSTK-{uuid4().hex}"
        document = {
            "reference": reference,
            "paystack_reference": reference,
            "player_id": actor["id"],
            "subscription_id": str(subscription["_id"]),
            "billing_month": month,
            "purpose": f"{months}-Month BragRight subscription",
            "payment_type": payment_type,
            "months": months,
            "monthly_rate_minor": plan["monthly_rate_minor"],
            "amount_minor": amount_minor,
            "currency": "GHS",
            "first_covered_period": plan["first_covered_period"],
            "last_covered_period": plan["last_covered_period"],
            "covered_periods": plan["covered_periods"],
            "coverage_keys": [f"{actor['id']}:{period}" for period in plan["covered_periods"]],
            "status": "paystack_pending",
            "provider_status": "pending",
            "payment_method": "mobile_money",
            "source": "paystack",
            "recorded_by": actor["id"],
            "received_by": "paystack",
            "payment_date": None,
            "paid_at": None,
            "verified_at": None,
            "fulfilled_at": None,
            "metadata": {
                "player_id": actor["id"],
                "payment_type": payment_type,
                "months": months,
                "covered_periods": plan["covered_periods"],
            },
            "deduplication_key": deduplication_key,
            "created_at": now,
            "updated_at": now,
        }
        try:
            payment_id = payments.insert_one(document).inserted_id
            payment = payments.find_one({"_id": payment_id})
        except DuplicateKeyError:
            payment = payments.find_one({"deduplication_key": deduplication_key})
            if not payment:
                return _error(
                    "One or more selected subscription periods are already reserved or paid.",
                    409,
                    "subscription_period_already_allocated",
                )

    safe_metadata = {
        "player_id": payment["player_id"],
        "payment_id": str(payment["_id"]),
        "payment_type": payment["payment_type"],
        "months": payment.get("months") or 1,
        "covered_periods": payment.get("covered_periods") or [payment["billing_month"]],
    }
    try:
        initialized = initialize_transaction(
            current_app.config,
            email=g.current_user["email"],
            amount_minor=payment["amount_minor"],
            reference=payment["reference"],
            metadata=safe_metadata,
        )
    except PaystackError as error:
        payments.update_one(
            {"_id": payment["_id"], "fulfilled_at": None},
            {"$set": {
                "status": "initialization_failed",
                "initialization_outcome_unknown": bool(error.outcome_unknown),
                "provider_http_status": error.provider_status,
                "updated_at": utc_now(),
            }},
        )
        return _paystack_error(error)
    if str(initialized.get("reference") or "") != payment["reference"] or not initialized.get("authorization_url"):
        return _paystack_error(PaystackError("Paystack returned an invalid checkout response."))
    payments.update_one(
        {"_id": payment["_id"], "fulfilled_at": None},
        {"$set": {
            "status": "paystack_initialized",
            "authorization_url": initialized["authorization_url"],
            "provider_access_code": initialized.get("access_code"),
            "updated_at": utc_now(),
        }, "$unset": {
            "initialization_outcome_unknown": "",
            "provider_http_status": "",
        }},
    )
    return jsonify({
        "success": True,
        "data": {
            "authorization_url": initialized["authorization_url"],
            "reference": payment["reference"],
            "payment": serialize_financial_document(payments.find_one({"_id": payment["_id"]})),
        },
    }), 201


@payments_bp.get("/paystack/verify")
@require_role("player")
def verify_paystack_payment():
    reference = str(request.args.get("reference") or "").strip()
    payment = get_payments_collection(config=current_app.config).find_one(
        {"paystack_reference": reference, "player_id": str(g.current_user["_id"]), "source": "paystack"}
    )
    if not payment:
        return _error("Payment was not found.", 404, "not_found")
    try:
        provider_data = verify_transaction(current_app.config, reference)
        updated, _ = _fulfill_verified_paystack_payment(payment, provider_data)
    except PaystackError as error:
        return _paystack_error(error)
    return jsonify({"success": True, "data": {"payment": serialize_financial_document(updated)}})


@payments_bp.post("/paystack/webhook")
def paystack_webhook():
    raw_body = request.get_data(cache=True)
    supplied_signature = str(request.headers.get("x-paystack-signature") or "").strip().lower()
    secret = str(current_app.config.get("PAYSTACK_SECRET_KEY") or "")
    expected_signature = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha512).hexdigest()
    if not secret.startswith("sk_test_") or not supplied_signature or not hmac.compare_digest(supplied_signature, expected_signature):
        return _error("Webhook signature is invalid.", 401, "invalid_webhook_signature")
    event = request.get_json(silent=True)
    if not isinstance(event, dict):
        return _error("Webhook payload is invalid.", 400, "invalid_webhook_payload")
    if event.get("event") != "charge.success":
        return jsonify({"success": True, "data": {"processed": False}})
    reference = str((event.get("data") or {}).get("reference") or "")
    payment = get_payments_collection(config=current_app.config).find_one(
        {"paystack_reference": reference, "source": "paystack"}
    )
    if not payment:
        return _error("Payment was not found.", 404, "not_found")
    if payment.get("fulfilled_at"):
        return jsonify({"success": True, "data": {"processed": False, "duplicate": True}})
    try:
        provider_data = verify_transaction(current_app.config, reference)
        updated, fulfilled = _fulfill_verified_paystack_payment(payment, provider_data)
    except PaystackError as error:
        return _paystack_error(error)
    if str(provider_data.get("status") or "").lower() != "success":
        return _error("Paystack transaction is not successful.", 409, "transaction_not_successful")
    return jsonify({
        "success": True,
        "data": {"processed": fulfilled, "payment_id": str(updated["_id"])},
    })


@payments_bp.get("/history")
@require_role("player")
def get_payment_history():
    items = list(
        get_payments_collection(config=current_app.config)
        .find({"player_id": str(g.current_user["_id"])})
        .sort("created_at", DESCENDING)
        .limit(100)
    )
    history = [
        {
            "purpose": item.get("purpose") or "Monthly BragRight subscription",
            "months": int(item.get("months") or 1),
            "amount": money(item.get("amount_minor")),
            "currency": item.get("currency") or "GHS",
            "status": item.get("status"),
            "reference": item.get("reference"),
            "first_covered_period": item.get("first_covered_period") or item.get("billing_month"),
            "last_covered_period": item.get("last_covered_period") or item.get("billing_month"),
            "covered_periods": item.get("covered_periods") or ([item["billing_month"]] if item.get("billing_month") else []),
            "paid_through_period": item.get("paid_through_period"),
            "date": (item.get("paid_at") or item.get("payment_date") or item.get("created_at")).isoformat()
            if item.get("paid_at") or item.get("payment_date") or item.get("created_at")
            else None,
        }
        for item in items
    ]
    return jsonify({"success": True, "data": {"payments": history}})


@payments_bp.get("/notifications")
@require_role("player", *FINANCIAL_ROLES)
def payment_notifications():
    actor = _current_actor()
    items = list(
        get_notifications_collection(config=current_app.config)
        .find({"user_id": actor["id"]})
        .sort("created_at", DESCENDING)
        .limit(50)
    )
    return jsonify(
        {
            "success": True,
            "data": {
                "counts": {"financial": len(items), "actions_required": 0},
                "items": [
                    {
                        "id": str(item["_id"]),
                        "type": item.get("event_type"),
                        "message": item.get("message"),
                        "match_id": None,
                        "created_at": item.get("created_at").isoformat()
                        if item.get("created_at")
                        else None,
                        "action_label": "View payments",
                        "action_path": (
                            "/payments/dashboard"
                            if actor["role"] == PAYMENT_OFFICER_ROLE
                            else "/payments/status"
                        ),
                    }
                    for item in items
                ],
            },
        }
    )


@payments_bp.get("/subscription/me")
@require_role("player")
def get_my_subscription():
    user = g.current_user
    month = normalize_billing_month(request.args.get("billing_month") or current_billing_month())
    subscription = get_subscriptions_collection(config=current_app.config).find_one(
        {"player_id": str(user["_id"]), "billing_month": month}
    ) or get_or_create_subscription(current_app.config, str(user["_id"]), month)
    payments = list(
        get_payments_collection(config=current_app.config)
        .find({"player_id": str(user["_id"])})
        .sort("payment_date", DESCENDING)
        .limit(50)
    )
    access = subscription_access(current_app.config, user)
    preview_options = [
        (
            {
                "months": plan["months"],
                "monthly_rate": money(plan["monthly_rate_minor"]),
                "total": money(plan["total_minor"]),
                "currency": plan["currency"],
                "first_covered_period": plan["first_covered_period"],
                "last_covered_period": plan["last_covered_period"],
                "covered_periods": plan["covered_periods"],
                "paid_through_period": plan["paid_through_period"],
            }
        )
        for plan in pay_ahead_options(current_app.config, str(user["_id"]))
    ]
    notifications = list(
        get_notifications_collection(config=current_app.config)
        .find({"user_id": str(user["_id"])})
        .sort("created_at", DESCENDING)
        .limit(25)
    )
    return jsonify(
        {
            "success": True,
            "data": {
                "access": access,
                "subscription": serialize_financial_document(subscription),
                "payments": [serialize_financial_document(item) for item in payments],
                "pay_ahead_options": preview_options,
                "notifications": [serialize_financial_document(item) for item in notifications],
                "instructions": settings_from_config(current_app.config)["payment_instructions"],
                "payment_destination": settings_from_config(current_app.config)["payment_destination"],
                "support_contact": settings_from_config(current_app.config)["support_contact"],
                "settings": {
                    "monthly_fee": money(
                        settings_from_config(current_app.config)["monthly_fee_minor"]
                    ),
                    "currency": settings_from_config(current_app.config)["currency"],
                },
            },
        }
    )


@payments_bp.post("/submissions")
@require_role("player")
def submit_player_payment():
    try:
        payload, body_error = get_json_object(
            allowed_fields={
                "billing_month",
                "amount",
                "payment_method",
                "payment_date",
                "reference",
                "proof",
                "note",
            }
        )
        if body_error:
            return body_error
        actor = _current_actor()
        month = normalize_billing_month(payload.get("billing_month"))
        amount_minor = parse_amount_minor(payload.get("amount"))
        method = str(payload.get("payment_method") or "").strip().lower()
        if method not in PAYMENT_METHODS:
            raise SubscriptionError("Payment method is invalid.")
        reference = _validated_reference(payload.get("reference"), required=method != "cash")
        proof = str(payload.get("proof") or "").strip()
        proof_upload = _owned_proof(proof, actor["id"]) if proof else None
        note = str(payload.get("note") or "").strip()
        if len(note) > 500:
            raise SubscriptionError("Note must be 500 characters or fewer.")

        subscription = get_or_create_subscription(current_app.config, actor["id"], month)
        if subscription.get("status") in {"active", "exempted"}:
            raise SubscriptionError(
                "This subscription is already paid or exempted.",
                code="subscription_already_satisfied",
                status_code=409,
            )
        if amount_minor != int(subscription["amount_due_minor"]):
            raise SubscriptionError(
                f"Amount must equal the monthly fee of {money(subscription['amount_due_minor']):.2f} "
                f"{subscription['currency']}.",
                code="invalid_payment_amount",
            )

        payments = get_payments_collection(config=current_app.config)
        if payments.find_one(
            {
                "player_id": actor["id"],
                "billing_month": month,
                "status": {"$in": ["pending_verification", "recorded", "verified"]},
            }
        ):
            raise SubscriptionError(
                "A payment or pending submission already exists for this billing month.",
                code="duplicate_payment",
                status_code=409,
            )
        now = utc_now()
        document = {
            "player_id": actor["id"],
            "subscription_id": str(subscription["_id"]),
            "billing_month": month,
            "amount_minor": amount_minor,
            "currency": settings_from_config(current_app.config)["currency"],
            "payment_method": method,
            "reference": reference,
            "proof": proof or None,
            "payment_date": _parse_date(payload.get("payment_date"), "Payment date"),
            "recorded_by": actor["id"],
            "received_by": None,
            "source": "player_submission",
            "status": "pending_verification",
            "note": note or None,
            "deduplication_key": f"{actor['id']}:{month}",
            "created_at": now,
            "updated_at": now,
        }
        try:
            payment_id = payments.insert_one(document).inserted_id
        except DuplicateKeyError as error:
            raise SubscriptionError(
                "A payment or pending submission already exists for this billing month.",
                code="duplicate_payment",
                status_code=409,
            ) from error
        if proof_upload:
            get_proof_uploads_collection(config=current_app.config).update_one(
                {"_id": proof_upload["_id"], "financial_record_id": None},
                {"$set": {"financial_record_id": str(payment_id), "record_type": "payment"}},
            )
        updated_subscription = recalculate_subscription(
            current_app.config, actor["id"], month, now=now
        )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="payment_submitted",
            target_user_id=actor["id"],
            amount_minor=amount_minor,
            billing_month=month,
            previous_state=subscription.get("status"),
            new_state="pending_verification",
            reference=reference,
            metadata={"payment_id": str(payment_id), "method": method},
        )
        notify_user(
            current_app.config,
            actor["id"],
            "payment_submitted",
            f"Your payment for {month} was submitted and is awaiting verification.",
            {"payment_id": str(payment_id), "billing_month": month},
        )
        return jsonify(
            {
                "success": True,
                "message": "Payment submitted for verification. Access remains restricted until approval.",
                "data": {
                    "payment": serialize_financial_document(payments.find_one({"_id": payment_id})),
                    "subscription": serialize_financial_document(updated_subscription),
                },
            }
        ), 201
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.get("/players")
@require_role(*FINANCIAL_ROLES)
def search_subscription_players():
    search = str(request.args.get("search") or "").strip()
    status_filter = str(request.args.get("subscription_status") or "").strip().lower()
    month = normalize_billing_month(request.args.get("billing_month") or current_billing_month())
    if len(search) > 100:
        return _error("Search must be 100 characters or fewer.")
    query = {"$or": [{"role": "player"}, {"role": {"$exists": False}}]}
    if search:
        escaped = re.escape(search)
        query = {
            "$and": [
                query,
                {
                    "$or": [
                        {"username": {"$regex": escaped, "$options": "i"}},
                        {"email": {"$regex": escaped, "$options": "i"}},
                    ]
                },
            ]
        }
    players = list(
        get_users_collection(config=current_app.config)
        .find(query)
        .sort("username", 1)
        .limit(100)
    )
    subscriptions = {
        item["player_id"]: item
        for item in get_subscriptions_collection(config=current_app.config).find(
            {"player_id": {"$in": [str(player["_id"]) for player in players]}, "billing_month": month}
        )
    }
    data = []
    for player in players:
        player_id = str(player["_id"])
        subscription = subscriptions.get(player_id)
        data.append(
            {
                "id": player_id,
                "username": player.get("username") or "Player",
                "email": player.get("email") or "",
                "security_status": player.get("status") or "active",
                "subscription_status": (
                    subscription.get("status") if subscription else "payment_due"
                ),
                "subscription": serialize_financial_document(subscription),
            }
        )
    if status_filter:
        data = [item for item in data if item["subscription_status"] == status_filter]
    return jsonify({"success": True, "data": {"players": data, "billing_month": month}})


@payments_bp.post("/payments")
@require_role(*FINANCIAL_ROLES)
def record_payment():
    try:
        payload, body_error = get_json_object(
            allowed_fields={
                "player_id",
                "billing_month",
                "amount",
                "payment_method",
                "payment_date",
                "reference",
                "proof",
                "note",
            }
        )
        if body_error:
            return body_error
        actor = _current_actor()
        player = _load_player(payload.get("player_id"))
        month = normalize_billing_month(payload.get("billing_month"))
        amount_minor = parse_amount_minor(payload.get("amount"))
        method = str(payload.get("payment_method") or "").strip().lower()
        if method not in PAYMENT_METHODS:
            raise SubscriptionError("Payment method is invalid.")
        reference = _validated_reference(
            payload.get("reference"), required=method != "cash"
        )
        proof = str(payload.get("proof") or "").strip()
        if len(proof) > 500:
            raise SubscriptionError("Proof attachment reference is too long.")
        proof_upload = _owned_proof(proof, actor["id"]) if proof else None
        note = str(payload.get("note") or "").strip()
        if len(note) > 500:
            raise SubscriptionError("Note must be 500 characters or fewer.")
        subscription = get_or_create_subscription(
            current_app.config, str(player["_id"]), month
        )
        payments = get_payments_collection(config=current_app.config)
        if payments.find_one(
            {
                "player_id": str(player["_id"]),
                "billing_month": month,
                "status": {"$in": ["recorded", "verified"]},
            }
        ):
            raise SubscriptionError(
                "A valid payment already exists for this player and billing month.",
                code="duplicate_payment",
                status_code=409,
            )
        if subscription.get("status") in {"active", "exempted"} or int(
            subscription.get("amount_paid_minor") or 0
        ) >= int(subscription["amount_due_minor"]):
            raise SubscriptionError(
                "This subscription is already fully paid or exempted.",
                code="subscription_already_satisfied",
                status_code=409,
            )
        if amount_minor != int(subscription["amount_due_minor"]):
            raise SubscriptionError(
                f"Amount must equal the monthly fee of "
                f"{money(subscription['amount_due_minor']):.2f} "
                f"{subscription['currency']}.",
                code="invalid_payment_amount",
            )
        settings = settings_from_config(current_app.config)
        now = utc_now()
        deduplication_key = f"{player['_id']}:{month}"
        document = {
            "player_id": str(player["_id"]),
            "subscription_id": str(subscription["_id"]),
            "billing_month": month,
            "amount_minor": amount_minor,
            "currency": settings["currency"],
            "payment_method": method,
            "reference": reference,
            "proof": proof or None,
            "payment_date": _parse_date(payload.get("payment_date"), "Payment date"),
            "recorded_by": actor["id"],
            "received_by": actor["id"],
            "status": "recorded",
            "note": note or None,
            "deduplication_key": deduplication_key,
            "created_at": now,
            "updated_at": now,
        }
        try:
            payment_id = payments.insert_one(document).inserted_id
        except DuplicateKeyError as error:
            raise SubscriptionError(
                "A valid payment already exists for this player and billing month.",
                code="duplicate_payment",
                status_code=409,
            ) from error
        updated = recalculate_subscription(
            current_app.config, str(player["_id"]), month, now=now
        )
        if proof_upload:
            get_proof_uploads_collection(config=current_app.config).update_one(
                {"_id": proof_upload["_id"], "financial_record_id": None},
                {"$set": {"financial_record_id": str(payment_id), "record_type": "payment"}},
            )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="payment_recorded",
            target_user_id=str(player["_id"]),
            amount_minor=amount_minor,
            billing_month=month,
            previous_state=subscription.get("status"),
            new_state=updated.get("status"),
            reference=reference,
            metadata={"payment_id": str(payment_id), "method": method},
        )
        month_label = datetime.strptime(month, "%Y-%m").strftime("%B %Y")
        notify_user(
            current_app.config,
            str(player["_id"]),
            "payment_recorded",
            f"Your GH₵{money(amount_minor):.2f} payment for {month_label} has been recorded. "
            + (
                "Your subscription is active."
                if updated["status"] == "active"
                else "It is pending verification."
            ),
            {"payment_id": str(payment_id), "billing_month": month},
        )
        access_activated = (
            updated["status"] == "active"
            and month == current_billing_month(now)
            and not has_security_restriction(player)
        )
        if access_activated:
            notify_user(
                current_app.config,
                str(player["_id"]),
                "account_activated",
                f"Your subscription for {month_label} is active.",
                {"payment_id": str(payment_id), "billing_month": month},
            )
        return jsonify(
            {
                "success": True,
                "message": (
                    "Payment recorded successfully. Player access is active."
                    if access_activated
                    else "Payment recorded successfully and the subscription was recalculated."
                ),
                "data": {
                    "payment": serialize_financial_document(
                        get_payments_collection(config=current_app.config).find_one(
                            {"_id": payment_id}
                        )
                    ),
                    "subscription": serialize_financial_document(updated),
                    "access_activated": access_activated,
                },
            }
        ), 201
    except SubscriptionError as error:
        return _handle_subscription_error(error)
    except PyMongoError:
        current_app.logger.exception("Could not record subscription payment")
        return _error("Could not record payment.", 500, "database_error")


@payments_bp.get("/payments")
@require_role(*FINANCIAL_ROLES)
def list_payments():
    actor = _current_actor()
    query = {}
    if actor["role"] == PAYMENT_OFFICER_ROLE:
        query["$or"] = [
            {"received_by": actor["id"]},
            {"source": "player_submission", "status": "pending_verification"},
        ]
    elif request.args.get("officer_id"):
        query["received_by"] = str(request.args.get("officer_id")).strip()
    month = request.args.get("billing_month")
    method = str(request.args.get("payment_method") or "").strip()
    status = str(request.args.get("status") or "").strip()
    player_search = str(request.args.get("player") or "").strip()
    if month:
        query["billing_month"] = normalize_billing_month(month)
    if method:
        if method not in PAYMENT_METHODS:
            return _error("Payment method filter is invalid.")
        query["payment_method"] = method
    if status:
        query["status"] = status
    if player_search:
        if len(player_search) > 100:
            return _error("Player filter must be 100 characters or fewer.")
        escaped = re.escape(player_search)
        matching_ids = [
            str(item["_id"])
            for item in get_users_collection(config=current_app.config).find(
                {
                    "$or": [
                        {"username": {"$regex": escaped, "$options": "i"}},
                        {"email": {"$regex": escaped, "$options": "i"}},
                    ]
                },
                {"_id": 1},
            ).limit(100)
        ]
        query["player_id"] = {"$in": matching_ids}
    items = list(
        get_payments_collection(config=current_app.config)
        .find(query)
        .sort("payment_date", DESCENDING)
        .limit(250)
    )
    return jsonify(
        {"success": True, "data": {"payments": [serialize_financial_document(item) for item in items]}}
    )


@payments_bp.post("/payments/<payment_id>/verify")
@require_role(*FINANCIAL_ROLES)
def verify_payment(payment_id):
    try:
        try:
            object_id = ObjectId(payment_id)
        except InvalidId as error:
            raise SubscriptionError("Payment ID is invalid.") from error
        payments = get_payments_collection(config=current_app.config)
        existing = payments.find_one({"_id": object_id})
        if not existing:
            raise SubscriptionError("Payment was not found.", code="not_found", status_code=404)
        actor = _current_actor()
        is_player_submission = (
            existing.get("source") == "player_submission"
            and existing.get("status") == "pending_verification"
        )
        if actor["role"] == PAYMENT_OFFICER_ROLE and not is_player_submission:
            raise SubscriptionError(
                "Payment Officers may only verify player-submitted payments.",
                code="insufficient_permissions",
                status_code=403,
            )
        if not is_player_submission and existing.get("status") != "recorded":
            raise SubscriptionError(
                "Only a recorded payment or pending player submission can be verified.",
                status_code=409,
            )
        now = utc_now()
        payments.update_one(
            {"_id": object_id, "status": existing["status"]},
            {
                "$set": {
                    "status": "verified",
                    "received_by": actor["id"] if is_player_submission else existing.get("received_by"),
                    "verified_by": actor["id"],
                    "verified_at": now,
                    "updated_at": now,
                }
            },
        )
        updated = recalculate_subscription(
            current_app.config, existing["player_id"], existing["billing_month"], now=now
        )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="payment_verified",
            target_user_id=existing["player_id"],
            amount_minor=existing["amount_minor"],
            billing_month=existing["billing_month"],
            previous_state=existing["status"],
            new_state="verified",
            reference=existing.get("reference"),
            metadata={"payment_id": payment_id},
        )
        player = _load_player(existing["player_id"])
        access_activated = (
            updated.get("status") == "active"
            and existing["billing_month"] == current_billing_month(now)
            and not has_security_restriction(player)
        )
        notify_user(
            current_app.config,
            existing["player_id"],
            "payment_verified",
            f"Your payment for {existing['billing_month']} was verified. "
            + ("Your subscription access is active." if access_activated else "Your account security status still limits access."),
            {"payment_id": payment_id},
        )
        return jsonify(
            {
                "success": True,
                "message": "Payment verified.",
                "data": {
                    "payment": serialize_financial_document(payments.find_one({"_id": object_id})),
                    "subscription": serialize_financial_document(updated),
                    "access_activated": access_activated,
                },
            }
        )
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.post("/payments/<payment_id>/reject")
@require_role(*FINANCIAL_ROLES)
def reject_player_payment(payment_id):
    try:
        payload, body_error = get_json_object(allowed_fields={"reason"})
        if body_error:
            return body_error
        reason = str(payload.get("reason") or "").strip()
        if not reason or len(reason) > 500:
            raise SubscriptionError("A rejection reason is required and must be 500 characters or fewer.")
        try:
            object_id = ObjectId(payment_id)
        except InvalidId as error:
            raise SubscriptionError("Payment ID is invalid.") from error
        payments = get_payments_collection(config=current_app.config)
        existing = payments.find_one({"_id": object_id})
        if not existing:
            raise SubscriptionError("Payment was not found.", code="not_found", status_code=404)
        if existing.get("source") != "player_submission" or existing.get("status") != "pending_verification":
            raise SubscriptionError("Only a pending player submission can be rejected.", status_code=409)
        actor = _current_actor()
        now = utc_now()
        payments.update_one(
            {"_id": object_id, "status": "pending_verification"},
            {
                "$set": {
                    "status": "rejected",
                    "deduplication_key": f"rejected:{payment_id}",
                    "rejected_by": actor["id"],
                    "rejected_at": now,
                    "rejection_reason": reason,
                    "updated_at": now,
                }
            },
        )
        subscription = recalculate_subscription(
            current_app.config, existing["player_id"], existing["billing_month"], now=now
        )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="payment_rejected",
            target_user_id=existing["player_id"],
            amount_minor=existing["amount_minor"],
            billing_month=existing["billing_month"],
            previous_state="pending_verification",
            new_state="rejected",
            reference=existing.get("reference"),
            reason=reason,
            metadata={"payment_id": payment_id},
        )
        notify_user(
            current_app.config,
            existing["player_id"],
            "payment_rejected",
            f"Your payment submission for {existing['billing_month']} was rejected: {reason}",
            {"payment_id": payment_id},
        )
        return jsonify(
            {
                "success": True,
                "message": "Payment submission rejected without deleting its record.",
                "data": {
                    "payment": serialize_financial_document(payments.find_one({"_id": object_id})),
                    "subscription": serialize_financial_document(subscription),
                },
            }
        )
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.get("/dashboard")
@require_role(*FINANCIAL_ROLES)
def payment_dashboard():
    actor = _current_actor()
    month = normalize_billing_month(request.args.get("billing_month") or current_billing_month())
    users = get_users_collection(config=current_app.config)
    player_count = users.count_documents(
        {"$or": [{"role": "player"}, {"role": {"$exists": False}}]}
    )
    if actor["role"] == PAYMENT_OFFICER_ROLE:
        ledger = officer_ledger(current_app.config, actor["id"], billing_month=month)
        valid_statuses = (
            ["verified"]
            if settings_from_config(current_app.config)["payment_requires_verification"]
            else ["recorded", "verified"]
        )
        paid_player_ids = get_payments_collection(
            config=current_app.config
        ).distinct(
            "player_id",
            {"billing_month": month, "status": {"$in": valid_statuses}},
        )
        paid_players = len(paid_player_ids)
        unpaid = max(player_count - paid_players, 0)
        data = {
            **serialize_ledger(ledger),
            "players_paid": paid_players,
            "unpaid_players": unpaid,
            "collection_rate": round((paid_players / player_count * 100), 1)
            if player_count
            else 0,
            "billing_month": month,
            "pending_submissions": get_payments_collection(
                config=current_app.config
            ).count_documents(
                {
                    "billing_month": month,
                    "source": "player_submission",
                    "status": "pending_verification",
                }
            ),
        }
        return jsonify({"success": True, "data": data})

    settings = settings_from_config(current_app.config)
    subscriptions = get_subscriptions_collection(config=current_app.config)
    payment_documents = list(
        get_payments_collection(config=current_app.config).find(
            {"billing_month": month, "status": {"$in": ["recorded", "verified"]}}
        )
    )
    remittance_documents = list(
        get_remittances_collection(config=current_app.config).find(
            {"billing_month": month, "status": "verified"}
        )
    )
    total_collected = sum(int(item.get("amount_minor") or 0) for item in payment_documents)
    total_remitted = sum(int(item.get("amount_minor") or 0) for item in remittance_documents)
    officer_ids = sorted({item.get("received_by") for item in payment_documents if item.get("received_by")})
    officer_objects = []
    for value in officer_ids:
        try:
            officer_objects.append(ObjectId(value))
        except InvalidId:
            continue
    officer_names = {
        str(item["_id"]): item.get("username") or item.get("email")
        for item in users.find({"_id": {"$in": officer_objects}})
    }
    breakdown = []
    for officer_id in officer_ids:
        ledger = officer_ledger(current_app.config, officer_id, billing_month=month)
        breakdown.append(
            {
                "officer_id": officer_id,
                "officer": officer_names.get(officer_id, "Unavailable officer"),
                **serialize_ledger(ledger),
                "collection_rate": round(
                    ledger["players_paid"] / player_count * 100, 1
                )
                if player_count
                else 0,
            }
        )
    data = {
        "billing_month": month,
        "expected_monthly_revenue": money(player_count * settings["monthly_fee_minor"]),
        "total_collected": money(total_collected),
        "total_verified_remitted": money(total_remitted),
        "unremitted_balance": money(max(total_collected - total_remitted, 0)),
        "outstanding_player_payments": subscriptions.count_documents(
            {"billing_month": month, "status": {"$in": ["payment_due", "grace_period", "restricted"]}}
        ),
        "active_players": subscriptions.count_documents(
            {"billing_month": month, "status": "active"}
        ),
        "restricted_players": subscriptions.count_documents(
            {"billing_month": month, "status": "restricted"}
        ),
        "exemptions": subscriptions.count_documents(
            {"billing_month": month, "status": "exempted"}
        ),
        "reversals": get_payments_collection(config=current_app.config).count_documents(
            {"billing_month": month, "status": "reversed"}
        ),
        "pending_submissions": get_payments_collection(config=current_app.config).count_documents(
            {
                "billing_month": month,
                "source": "player_submission",
                "status": "pending_verification",
            }
        ),
        "officers": breakdown,
    }
    return jsonify({"success": True, "data": data})


@payments_bp.post("/remittances")
@require_role(PAYMENT_OFFICER_ROLE)
def submit_remittance():
    try:
        payload, body_error = get_json_object(
            allowed_fields={
                "amount", "method", "destination", "reference",
                "remittance_date", "proof", "note", "billing_month",
            }
        )
        if body_error:
            return body_error
        actor = _current_actor()
        amount_minor = parse_amount_minor(payload.get("amount"))
        method = str(payload.get("method") or "").strip().lower()
        if method not in REMITTANCE_METHODS:
            raise SubscriptionError("Remittance method is invalid.")
        destination = str(payload.get("destination") or "").strip()
        if not destination or len(destination) > 120:
            raise SubscriptionError("Destination is required and must be 120 characters or fewer.")
        reference = _validated_reference(payload.get("reference"), required=True)
        proof = str(payload.get("proof") or "").strip()
        proof_upload = _owned_proof(proof, actor["id"]) if proof else None
        month = normalize_billing_month(payload.get("billing_month") or current_billing_month())
        ledger = officer_ledger(current_app.config, actor["id"], billing_month=month)
        available = ledger["available_to_remit_minor"]
        if amount_minor > available:
            raise SubscriptionError(
                "Remittance exceeds the available unremitted balance.",
                code="over_remittance",
                status_code=409,
            )
        now = utc_now()
        document = {
            "payment_officer_id": actor["id"],
            "billing_month": month,
            "amount_minor": amount_minor,
            "currency": settings_from_config(current_app.config)["currency"],
            "method": method,
            "destination": destination,
            "reference": reference,
            "proof": proof or None,
            "remittance_date": _parse_date(payload.get("remittance_date"), "Remittance date"),
            "submitted_at": now,
            "status": "pending_verification",
            "note": str(payload.get("note") or "").strip() or None,
            "verified_by": None,
            "verified_at": None,
            "rejection_reason": None,
            "updated_at": now,
        }
        remittance_id = get_remittances_collection(config=current_app.config).insert_one(
            document
        ).inserted_id
        if proof_upload:
            get_proof_uploads_collection(config=current_app.config).update_one(
                {"_id": proof_upload["_id"], "financial_record_id": None},
                {"$set": {"financial_record_id": str(remittance_id), "record_type": "remittance"}},
            )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="remittance_submitted",
            target_user_id=actor["id"],
            amount_minor=amount_minor,
            billing_month=month,
            new_state="pending_verification",
            reference=reference,
            metadata={"remittance_id": str(remittance_id)},
        )
        super_admins = get_users_collection(config=current_app.config).find(
            {"role": SUPER_ADMIN_ROLE, "status": "active"}
        )
        for super_admin in super_admins:
            notify_user(
                current_app.config,
                str(super_admin["_id"]),
                "remittance_submitted",
                f"{actor['username'] or 'A Payment Officer'} submitted a GH₵{money(amount_minor):.2f} remittance for verification.",
                {"remittance_id": str(remittance_id), "officer_id": actor["id"]},
            )
        return jsonify(
            {
                "success": True,
                "message": "Remittance submitted for Super Admin verification.",
                "data": serialize_financial_document(
                    get_remittances_collection(config=current_app.config).find_one(
                        {"_id": remittance_id}
                    )
                ),
            }
        ), 201
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.get("/remittances")
@require_role(*FINANCIAL_ROLES)
def list_remittances():
    actor = _current_actor()
    query = (
        {"payment_officer_id": actor["id"]}
        if actor["role"] == PAYMENT_OFFICER_ROLE
        else {}
    )
    status = str(request.args.get("status") or "").strip()
    if status:
        query["status"] = status
    items = list(
        get_remittances_collection(config=current_app.config)
        .find(query)
        .sort("submitted_at", DESCENDING)
        .limit(250)
    )
    serialized_items = []
    users = get_users_collection(config=current_app.config)
    for item in items:
        serialized = serialize_financial_document(item)
        if actor["role"] in SUPER_ADMIN_ROLES:
            try:
                officer = users.find_one({"_id": ObjectId(item["payment_officer_id"])})
            except (InvalidId, TypeError):
                officer = None
            ledger = officer_ledger(
                current_app.config,
                item["payment_officer_id"],
                billing_month=item.get("billing_month"),
            )
            serialized["officer"] = {
                "id": item["payment_officer_id"],
                "name": (officer or {}).get("username") or "Unavailable officer",
            }
            serialized["officer_ledger"] = serialize_ledger(ledger)
        serialized_items.append(serialized)
    return jsonify(
        {"success": True, "data": {"remittances": serialized_items}}
    )


@payments_bp.patch("/remittances/<remittance_id>")
@require_role(SUPER_ADMIN_ROLE)
def review_remittance(remittance_id):
    try:
        payload, body_error = get_json_object(allowed_fields={"action", "reason"})
        if body_error:
            return body_error
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"verify", "reject", "reverse", "request_clarification"}:
            raise SubscriptionError("Review action is invalid.")
        reason = str(payload.get("reason") or "").strip()
        if action != "verify" and not reason:
            raise SubscriptionError("A reason is required for rejection or clarification.")
        try:
            object_id = ObjectId(remittance_id)
        except InvalidId as error:
            raise SubscriptionError("Remittance ID is invalid.") from error
        remittances = get_remittances_collection(config=current_app.config)
        existing = remittances.find_one({"_id": object_id})
        if not existing:
            raise SubscriptionError("Remittance was not found.", code="not_found", status_code=404)
        if action == "reverse":
            if existing.get("status") != "verified":
                raise SubscriptionError("Only a verified remittance can be reversed.", status_code=409)
        elif existing.get("status") not in {"submitted", "pending_verification"}:
            raise SubscriptionError("This remittance has already been reviewed.", status_code=409)
        actor = _current_actor()
        next_status = (
            "verified"
            if action == "verify"
            else "rejected"
            if action == "reject"
            else "reversed"
            if action == "reverse"
            else "pending_verification"
        )
        now = utc_now()
        updated = remittances.find_one_and_update(
            {"_id": object_id, "status": existing["status"]},
            {
                "$set": {
                    "status": next_status,
                    "verified_by": actor["id"] if action == "verify" else None,
                    "verified_at": now if action == "verify" else None,
                    "rejection_reason": reason or None,
                    "reversed_by": actor["id"] if action == "reverse" else None,
                    "reversed_at": now if action == "reverse" else None,
                    "reversal_reason": reason if action == "reverse" else None,
                    "updated_at": now,
                }
            },
            return_document=True,
        )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action=f"remittance_{next_status}",
            target_user_id=existing["payment_officer_id"],
            amount_minor=existing["amount_minor"],
            billing_month=existing.get("billing_month"),
            previous_state=existing["status"],
            new_state=next_status,
            reference=existing.get("reference"),
            reason=reason or None,
            metadata={"remittance_id": remittance_id},
        )
        notify_user(
            current_app.config,
            existing["payment_officer_id"],
            f"remittance_{next_status}",
            f"Your GH₵{money(existing['amount_minor']):.2f} remittance was {next_status.replace('_', ' ')}.",
            {"remittance_id": remittance_id},
        )
        return jsonify(
            {"success": True, "message": f"Remittance {next_status}.", "data": serialize_financial_document(updated)}
        )
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.post("/exemptions")
@require_role(SUPER_ADMIN_ROLE)
def grant_exemption():
    try:
        payload, body_error = get_json_object(
            allowed_fields={"player_id", "billing_month", "reason", "note", "expiry"}
        )
        if body_error:
            return body_error
        player = _load_player(payload.get("player_id"))
        month = normalize_billing_month(payload.get("billing_month"))
        reason = str(payload.get("reason") or "").strip()
        if not reason or len(reason) > 300:
            raise SubscriptionError("Exemption reason is required and must be 300 characters or fewer.")
        actor = _current_actor()
        now = utc_now()
        subscription = get_or_create_subscription(current_app.config, str(player["_id"]), month)
        document = {
            "player_id": str(player["_id"]),
            "billing_month": month,
            "reason": reason,
            "approved_by": actor["id"],
            "approved_at": now,
            "expiry": _parse_date(payload.get("expiry"), "Expiry") if payload.get("expiry") else subscription["expires_at"],
            "note": str(payload.get("note") or "").strip() or None,
            "status": "active",
            "created_at": now,
            "updated_at": now,
        }
        try:
            exemption_id = get_subscription_exemptions_collection(
                config=current_app.config
            ).insert_one(document).inserted_id
        except DuplicateKeyError as error:
            raise SubscriptionError(
                "An exemption already exists for this player and month.",
                code="duplicate_exemption",
                status_code=409,
            ) from error
        updated = recalculate_subscription(current_app.config, str(player["_id"]), month)
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="exemption_granted",
            target_user_id=str(player["_id"]),
            billing_month=month,
            previous_state=subscription["status"],
            new_state=updated["status"],
            reason=reason,
            metadata={"exemption_id": str(exemption_id)},
        )
        notify_user(
            current_app.config,
            str(player["_id"]),
            "exemption_granted",
            f"A subscription exemption was granted for {month}. Your account is active.",
            {"billing_month": month},
        )
        return jsonify(
            {"success": True, "message": "Exemption granted.", "data": serialize_financial_document(updated)}
        ), 201
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.post("/subscriptions/<player_id>/override")
@require_role(SUPER_ADMIN_ROLE)
def override_subscription_access(player_id):
    try:
        payload, body_error = get_json_object(
            allowed_fields={"billing_month", "action", "reason"}
        )
        if body_error:
            return body_error
        player = _load_player(player_id)
        month = normalize_billing_month(payload.get("billing_month") or current_billing_month())
        action = str(payload.get("action") or "").strip().lower()
        if action not in {"restrict", "restore", "clear"}:
            raise SubscriptionError("Override action must be restrict, restore, or clear.")
        reason = str(payload.get("reason") or "").strip()
        if not reason or len(reason) > 500:
            raise SubscriptionError("Override reason is required and must be 500 characters or fewer.")
        actor = _current_actor()
        existing = get_or_create_subscription(current_app.config, str(player["_id"]), month)
        override_status = {"restrict": "suspended", "restore": "active", "clear": None}[action]
        get_subscriptions_collection(config=current_app.config).update_one(
            {"_id": existing["_id"]},
            {
                "$set": {
                    "override_status": override_status,
                    "override_reason": reason,
                    "overridden_by": actor["id"],
                    "overridden_at": utc_now(),
                }
            },
        )
        updated = recalculate_subscription(current_app.config, str(player["_id"]), month)
        create_financial_audit(
            current_app.config,
            actor=actor,
            action=f"subscription_override_{action}",
            target_user_id=str(player["_id"]),
            billing_month=month,
            previous_state=existing["status"],
            new_state=updated["status"],
            reason=reason,
        )
        notify_user(
            current_app.config,
            str(player["_id"]),
            "account_restricted" if action == "restrict" else "account_activated",
            "Your subscription access was restricted by a Super Admin."
            if action == "restrict"
            else "Your subscription access was restored by a Super Admin.",
            {"billing_month": month},
        )
        return jsonify(
            {"success": True, "message": "Subscription override recorded.", "data": serialize_financial_document(updated)}
        )
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.post("/payments/<payment_id>/reverse")
@require_role(SUPER_ADMIN_ROLE)
def reverse_payment(payment_id):
    try:
        payload, body_error = get_json_object(allowed_fields={"reason", "evidence"})
        if body_error:
            return body_error
        reason = str(payload.get("reason") or "").strip()
        if not reason or len(reason) > 500:
            raise SubscriptionError("Reversal reason is required and must be 500 characters or fewer.")
        try:
            object_id = ObjectId(payment_id)
        except InvalidId as error:
            raise SubscriptionError("Payment ID is invalid.") from error
        payments = get_payments_collection(config=current_app.config)
        existing = payments.find_one({"_id": object_id})
        if not existing:
            raise SubscriptionError("Payment was not found.", code="not_found", status_code=404)
        if existing.get("status") not in {"recorded", "verified"}:
            raise SubscriptionError("Only a valid payment can be reversed.", status_code=409)
        actor = _current_actor()
        now = utc_now()
        payments.update_one(
            {"_id": object_id, "status": existing["status"]},
            {
                "$set": {
                    "status": "reversed",
                    "deduplication_key": f"reversed:{payment_id}",
                    "reversed_by": actor["id"],
                    "reversed_at": now,
                    "reversal_reason": reason,
                    "reversal_evidence": str(payload.get("evidence") or "").strip() or None,
                    "updated_at": now,
                }
            },
        )
        updated = recalculate_subscription(
            current_app.config, existing["player_id"], existing["billing_month"], now=now
        )
        create_financial_audit(
            current_app.config,
            actor=actor,
            action="payment_reversed",
            target_user_id=existing["player_id"],
            amount_minor=existing["amount_minor"],
            billing_month=existing["billing_month"],
            previous_state=existing["status"],
            new_state=updated["status"],
            reference=existing.get("reference"),
            reason=reason,
            metadata={"payment_id": payment_id, "officer_id": existing.get("received_by")},
        )
        notify_user(
            current_app.config,
            existing["player_id"],
            "payment_reversed",
            f"Your GH₵{money(existing['amount_minor']):.2f} payment for {existing['billing_month']} was reversed. Contact support for help.",
            {"payment_id": payment_id},
        )
        if updated["status"] in {"restricted", "suspended"}:
            notify_user(
                current_app.config,
                existing["player_id"],
                "account_restricted",
                "Your subscription access is restricted because no valid payment or exemption remains.",
                {"payment_id": payment_id, "billing_month": existing["billing_month"]},
            )
        if existing.get("received_by"):
            notify_user(
                current_app.config,
                existing["received_by"],
                "payment_reversed",
                f"A GH₵{money(existing['amount_minor']):.2f} payment in your ledger was reversed.",
                {"payment_id": payment_id},
            )
        return jsonify(
            {"success": True, "message": "Payment reversed without deleting its record.", "data": serialize_financial_document(updated)}
        )
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.post("/billing/run")
@require_role(SUPER_ADMIN_ROLE)
def execute_monthly_billing():
    try:
        payload, body_error = get_json_object(
            allowed_fields={"billing_month", "dry_run"}, required=False
        )
        if body_error:
            return body_error
        summary = run_monthly_billing(
            current_app.config,
            _current_actor(),
            payload.get("billing_month") if payload else None,
            dry_run=bool((payload or {}).get("dry_run", False)),
        )
        return jsonify({"success": True, "message": "Billing process completed.", "data": summary})
    except SubscriptionError as error:
        return _handle_subscription_error(error)


@payments_bp.get("/audit")
@require_role(SUPER_ADMIN_ROLE)
def financial_audit_log():
    items = list(
        get_financial_audit_logs_collection(config=current_app.config)
        .find({})
        .sort("created_at", DESCENDING)
        .limit(500)
    )
    return jsonify(
        {"success": True, "data": {"events": [serialize_financial_document(item) for item in items]}}
    )
