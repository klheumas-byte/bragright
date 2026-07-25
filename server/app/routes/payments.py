import re
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
    recalculate_subscription,
    run_monthly_billing,
    serialize_financial_document,
    serialize_ledger,
    settings_from_config,
    subscription_access,
    utc_now,
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
