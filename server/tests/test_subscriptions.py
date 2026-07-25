from datetime import datetime, timezone
from io import BytesIO

import pytest
from pymongo.errors import DuplicateKeyError

from app import db as db_module
from app.services.subscription_service import (
    current_billing_month,
    get_or_create_subscription,
    officer_ledger,
    run_monthly_billing,
    subscription_access,
)


PASSWORD = "correct-horse-battery-staple"


def login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def record_payload(player, month="2026-08", reference="MOMO-2026-0001"):
    return {
        "player_id": str(player["_id"]),
        "billing_month": month,
        "amount": "20.00",
        "payment_method": "mobile_money",
        "payment_date": "2026-08-03",
        "reference": reference,
        "note": "Manual counter payment",
    }


def test_payment_officer_scope_and_super_admin_oversight(client, create_user):
    create_user("officer@example.com", role="payment_officer")
    create_user("super@example.com", role="super_admin")
    officer_headers = login(client, "officer@example.com")
    super_headers = login(client, "super@example.com")

    assert client.get("/api/payments/dashboard", headers=officer_headers).status_code == 200
    dashboard = client.get("/api/payments/dashboard", headers=officer_headers).json["data"]
    assert "total_collected" in dashboard
    assert "total_submitted" in dashboard
    assert "total_remitted" in dashboard
    assert "outstanding_balance" in dashboard
    assert client.get("/api/admin/users", headers=officer_headers).status_code == 403
    assert client.get("/api/admin/disputes", headers=officer_headers).status_code == 403
    assert client.get("/api/dashboard/summary", headers=officer_headers).status_code == 403
    assert client.get("/api/matches/my", headers=officer_headers).status_code == 403
    assert client.get("/api/payments/remittances", headers=officer_headers).status_code == 200
    assert client.post("/api/payments/remittances", json={}, headers=officer_headers).status_code == 422
    assert client.get("/api/admin/users", headers=super_headers).status_code == 200
    assert client.get("/api/payments/audit", headers=super_headers).status_code == 200


def test_admin_payment_screen_queries_load_players_and_accept_supported_filters(
    client, create_user
):
    create_user("alpha-player@example.com", username="Alpha Player")
    create_user("beta-player@example.com", username="Beta Player")
    create_user("admin@example.com", role="admin")
    headers = login(client, "admin@example.com")
    month = current_billing_month()

    players = client.get(
        f"/api/payments/players?billing_month={month}&search=Player",
        headers=headers,
    )
    dashboard = client.get(
        f"/api/payments/dashboard?billing_month={month}",
        headers=headers,
    )
    payments = client.get(
        f"/api/payments/payments?billing_month={month}&status=recorded",
        headers=headers,
    )
    remittances = client.get(
        f"/api/payments/remittances?billing_month={month}",
        headers=headers,
    )

    assert players.status_code == 200
    assert {item["email"] for item in players.json["data"]["players"]} == {
        "alpha-player@example.com",
        "beta-player@example.com",
    }
    assert dashboard.status_code == 200
    assert payments.status_code == 200
    assert remittances.status_code == 200


def test_subscription_unique_player_month_index(app, create_user):
    player = create_user("player@example.com")
    subscriptions = db_module.get_subscriptions_collection(config=app.config)
    first = get_or_create_subscription(app.config, str(player["_id"]), "2026-08")
    second = get_or_create_subscription(app.config, str(player["_id"]), "2026-08")

    assert first["_id"] == second["_id"]
    with pytest.raises(DuplicateKeyError):
        subscriptions.insert_one(
            {
                "player_id": str(player["_id"]),
                "billing_month": "2026-08",
                "amount_due_minor": 2000,
            }
        )


def test_billing_grace_and_restriction_are_idempotent(app, create_user):
    player = create_user("player@example.com")
    actor = {"id": "system", "username": "Billing", "role": "system"}

    grace = run_monthly_billing(
        app.config,
        actor,
        "2026-08",
        now=datetime(2026, 8, 4, tzinfo=timezone.utc),
    )
    again = run_monthly_billing(
        app.config,
        actor,
        "2026-08",
        now=datetime(2026, 8, 4, tzinfo=timezone.utc),
    )
    subscription = db_module.get_subscriptions_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "billing_month": "2026-08"}
    )

    assert grace["subscriptions_created"] == 1
    assert again["subscriptions_created"] == 0
    assert subscription["status"] == "grace_period"

    restricted = run_monthly_billing(
        app.config,
        actor,
        "2026-08",
        now=datetime(2026, 8, 12, tzinfo=timezone.utc),
    )
    subscription = db_module.get_subscriptions_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "billing_month": "2026-08"}
    )
    assert restricted["accounts_restricted"] == 1
    assert subscription["status"] == "restricted"


def test_record_payment_activates_and_prevents_duplicate(
    app, client, create_user
):
    player = create_user("player@example.com")
    officer = create_user("officer@example.com", role="payment_officer")
    headers = login(client, "officer@example.com")

    response = client.post(
        "/api/payments/payments",
        json=record_payload(player),
        headers=headers,
    )
    duplicate_payload = record_payload(player, reference="DIFFERENT-REFERENCE")
    duplicate = client.post(
        "/api/payments/payments",
        json=duplicate_payload,
        headers=headers,
    )

    assert response.status_code == 201
    assert response.json["data"]["subscription"]["status"] == "active"
    assert duplicate.status_code == 409
    ledger = officer_ledger(app.config, str(officer["_id"]), billing_month="2026-08")
    assert ledger["total_collected_minor"] == 2000
    assert ledger["payment_count"] == 1
    assert db_module.get_financial_audit_logs_collection(config=app.config).count_documents(
        {"action": "payment_recorded"}
    ) == 1
    assert db_module.get_notifications_collection(config=app.config).count_documents(
        {"user_id": str(player["_id"]), "event_type": "payment_recorded"}
    ) == 1


def test_payment_officer_dashboard_uses_real_global_paid_counts_and_own_totals(
    client, create_user
):
    first_player = create_user("first-player@example.com")
    second_player = create_user("second-player@example.com")
    first_officer = create_user("first-officer@example.com", role="payment_officer")
    create_user("second-officer@example.com", role="payment_officer")
    first_headers = login(client, "first-officer@example.com")
    second_headers = login(client, "second-officer@example.com")

    assert client.post(
        "/api/payments/payments",
        json=record_payload(first_player, reference="FIRST-OFFICER-1"),
        headers=first_headers,
    ).status_code == 201
    assert client.post(
        "/api/payments/payments",
        json=record_payload(second_player, reference="SECOND-OFFICER-1"),
        headers=second_headers,
    ).status_code == 201

    dashboard = client.get(
        "/api/payments/dashboard?billing_month=2026-08",
        headers=first_headers,
    ).json["data"]
    assert dashboard["total_collected"] == 20.0
    assert dashboard["payment_count"] == 1
    assert dashboard["players_paid"] == 2
    assert dashboard["unpaid_players"] == 0
    assert officer_ledger(
        client.application.config,
        str(first_officer["_id"]),
        billing_month="2026-08",
    )["total_collected_minor"] == 2000


def test_paid_subscription_does_not_override_banned_player_access(
    app, client, create_user
):
    player = create_user("banned-player@example.com")
    db_module.get_users_collection(config=app.config).update_one(
        {"_id": player["_id"]},
        {"$set": {"is_banned": True}},
    )
    create_user("officer@example.com", role="payment_officer")

    response = client.post(
        "/api/payments/payments",
        json=record_payload(player, reference="BANNED-PLAYER-1"),
        headers=login(client, "officer@example.com"),
    )
    stored_player = db_module.get_users_collection(config=app.config).find_one(
        {"_id": player["_id"]}
    )

    assert response.status_code == 201
    assert response.json["data"]["subscription"]["status"] == "active"
    assert response.json["data"]["access_activated"] is False
    assert subscription_access(app.config, stored_player)["reason"] == "security_restriction"
    assert db_module.get_notifications_collection(config=app.config).count_documents(
        {"user_id": str(player["_id"]), "event_type": "account_activated"}
    ) == 0


def test_valid_current_payment_activates_eligible_player_access(
    app, client, create_user
):
    player = create_user("eligible-player@example.com", subscription_access=False)
    create_user("officer@example.com", role="payment_officer")
    month = current_billing_month()

    response = client.post(
        "/api/payments/payments",
        json=record_payload(player, month=month, reference="CURRENT-PLAYER-1"),
        headers=login(client, "officer@example.com"),
    )
    stored_player = db_module.get_users_collection(config=app.config).find_one(
        {"_id": player["_id"]}
    )

    assert response.status_code == 201
    assert response.json["data"]["subscription"]["status"] == "active"
    assert response.json["data"]["access_activated"] is True
    assert subscription_access(app.config, stored_player)["allowed"] is True
    assert stored_player["status"] == "active"


def test_invalid_payment_amount_does_not_activate_player(client, create_user, app):
    player = create_user("player@example.com")
    create_user("officer@example.com", role="payment_officer")
    payload = record_payload(player)
    payload["amount"] = "19.99"

    response = client.post(
        "/api/payments/payments",
        json=payload,
        headers=login(client, "officer@example.com"),
    )

    assert response.status_code == 422
    assert response.json["error"]["code"] == "INVALID_PAYMENT_AMOUNT"
    subscription = db_module.get_subscriptions_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "billing_month": "2026-08"}
    )
    assert subscription["status"] != "active"
    assert db_module.get_payments_collection(config=app.config).count_documents({}) == 0
    assert db_module.get_notifications_collection(config=app.config).count_documents(
        {"user_id": str(player["_id"]), "event_type": "payment_recorded"}
    ) == 0


def test_restricted_player_can_view_payment_but_not_dashboard(
    app, client, create_user
):
    player = create_user("player@example.com")
    subscription = get_or_create_subscription(
        app.config,
        str(player["_id"]),
        datetime.now(timezone.utc).strftime("%Y-%m"),
        now=datetime.now(timezone.utc),
    )
    db_module.get_subscriptions_collection(config=app.config).update_one(
        {"_id": subscription["_id"]}, {"$set": {"status": "restricted"}}
    )
    headers = login(client, "player@example.com")

    assert client.get("/api/payments/subscription/me", headers=headers).status_code == 200
    blocked = client.get("/api/dashboard/summary", headers=headers)
    assert blocked.status_code == 403
    assert blocked.json["error"]["code"] == "SUBSCRIPTION_REQUIRED"


def test_security_disabled_status_overrides_subscription(client, create_user):
    create_user("disabled@example.com", status="disabled")
    response = client.post(
        "/api/auth/login",
        json={"email": "disabled@example.com", "password": PASSWORD},
    )
    assert response.status_code == 423


@pytest.mark.parametrize("status", ["disabled", "banned", "suspended"])
def test_security_restrictions_override_paid_subscription(app, create_user, status):
    player = create_user(f"{status}@example.com")
    subscription = get_or_create_subscription(
        app.config, str(player["_id"]), datetime.now(timezone.utc).strftime("%Y-%m")
    )
    db_module.get_subscriptions_collection(config=app.config).update_one(
        {"_id": subscription["_id"]}, {"$set": {"status": "active"}}
    )
    restricted_user = {**player, "status": status}

    access = subscription_access(app.config, restricted_user)

    assert access["allowed"] is False
    assert access["reason"] == "security_restriction"


def test_missing_payment_record_restricts_player_access(app, create_user):
    player = create_user("unpaid@example.com", subscription_access=False)

    access = subscription_access(app.config, player)

    assert access["allowed"] is False
    assert access["status"] == "payment_due"


def test_payment_and_password_route_errors_are_json(client, create_user):
    create_user("officer@example.com", role="payment_officer")
    headers = login(client, "officer@example.com")

    invalid_month = client.get(
        "/api/payments/dashboard?billing_month=not-a-month",
        headers=headers,
    )
    missing_password_route = client.post(
        "/api/auth/change-password",
        json={},
        headers=headers,
    )

    assert invalid_month.status_code == 422
    assert invalid_month.is_json
    assert invalid_month.json["error"]["code"] == "VALIDATION_ERROR"
    assert missing_password_route.status_code == 404
    assert missing_password_route.is_json
    assert missing_password_route.json["error"]["code"] == "NOT_FOUND"


def test_remittance_cannot_exceed_balance_and_requires_super_admin_verification(
    app, client, create_user
):
    player = create_user("player@example.com")
    officer = create_user("collector@example.com", role="payment_officer")
    create_user("officer@example.com", role="payment_officer")
    create_user("super@example.com", role="super_admin")
    officer_headers = login(client, "collector@example.com")
    super_headers = login(client, "super@example.com")
    client.post("/api/payments/payments", json=record_payload(player), headers=officer_headers)

    over = client.post(
        "/api/payments/remittances",
        json={
            "billing_month": "2026-08",
            "amount": "21.00",
            "method": "bank_deposit",
            "destination": "BragRight operations",
            "reference": "BANK-OVER-1",
        },
        headers=officer_headers,
    )
    valid = client.post(
        "/api/payments/remittances",
        json={
            "billing_month": "2026-08",
            "amount": "20.00",
            "method": "bank_deposit",
            "destination": "BragRight operations",
            "reference": "BANK-OK-1",
        },
        headers=officer_headers,
    )
    assert over.status_code == 409
    assert valid.status_code == 201
    assert valid.json["data"]["status"] == "pending_verification"

    remittance_id = valid.json["data"]["id"]
    officer_verify = client.patch(
        f"/api/payments/remittances/{remittance_id}",
        json={"action": "verify"},
        headers=login(client, "officer@example.com"),
    )
    assert officer_verify.status_code == 403
    verified = client.patch(
        f"/api/payments/remittances/{remittance_id}",
        json={"action": "verify"},
        headers=super_headers,
    )
    assert verified.status_code == 200
    assert officer_ledger(
        app.config, str(officer["_id"]), billing_month="2026-08"
    )["outstanding_balance_minor"] == 0


def test_remittance_rejection_requires_reason(client, create_user, app):
    player = create_user("player@example.com")
    create_user("collector@example.com", role="payment_officer")
    create_user("super@example.com", role="super_admin")
    officer_headers = login(client, "collector@example.com")
    super_headers = login(client, "super@example.com")
    client.post("/api/payments/payments", json=record_payload(player), headers=officer_headers)
    remittance = client.post(
        "/api/payments/remittances",
        json={
            "billing_month": "2026-08",
            "amount": "10.00",
            "method": "mobile_money",
            "destination": "Operations wallet",
            "reference": "REM-REJECT-1",
        },
        headers=officer_headers,
    ).json["data"]

    missing = client.patch(
        f"/api/payments/remittances/{remittance['id']}",
        json={"action": "reject"},
        headers=super_headers,
    )
    rejected = client.patch(
        f"/api/payments/remittances/{remittance['id']}",
        json={"action": "reject", "reason": "Deposit reference could not be reconciled."},
        headers=super_headers,
    )
    assert missing.status_code == 422
    assert rejected.status_code == 200
    stored = db_module.get_remittances_collection(config=app.config).find_one(
        {"_id": remittance["_id"]} if "_id" in remittance else {"reference": "REM-REJECT-1"}
    )
    assert stored["status"] == "rejected"
    assert stored["rejection_reason"]


def test_exemption_activates_without_fake_payment_and_reversal_preserves_record(
    app, client, create_user
):
    exempt_player = create_user("exempt@example.com")
    paid_player = create_user("paid@example.com")
    create_user("officer@example.com", role="payment_officer")
    create_user("super@example.com", role="super_admin")
    officer_headers = login(client, "officer@example.com")
    super_headers = login(client, "super@example.com")

    exemption = client.post(
        "/api/payments/exemptions",
        json={
            "player_id": str(exempt_player["_id"]),
            "billing_month": "2026-08",
            "reason": "Sponsored player",
        },
        headers=super_headers,
    )
    assert exemption.status_code == 201
    assert exemption.json["data"]["status"] == "exempted"
    assert db_module.get_payments_collection(config=app.config).count_documents(
        {"player_id": str(exempt_player["_id"])}
    ) == 0

    payment = client.post(
        "/api/payments/payments",
        json=record_payload(paid_player, reference="MOMO-REVERSE-1"),
        headers=officer_headers,
    ).json["data"]["payment"]
    reversal = client.post(
        f"/api/payments/payments/{payment['id']}/reverse",
        json={"reason": "Receipt was attributed to the wrong player."},
        headers=super_headers,
    )
    assert reversal.status_code == 200
    stored = db_module.get_payments_collection(config=app.config).find_one(
        {"reference": "MOMO-REVERSE-1"}
    )
    assert stored["status"] == "reversed"
    assert stored["reversal_reason"]
    assert db_module.get_financial_audit_logs_collection(config=app.config).count_documents(
        {"action": "payment_reversed"}
    ) == 1


def test_financial_proof_is_type_checked_and_owner_scoped(client, create_user):
    player = create_user("player@example.com")
    create_user("officer-one@example.com", role="payment_officer")
    create_user("officer-two@example.com", role="payment_officer")
    owner_headers = login(client, "officer-one@example.com")
    other_headers = login(client, "officer-two@example.com")
    uploaded = client.post(
        "/api/payments/upload-proof",
        data={"proof_image": (BytesIO(b"\x89PNG\r\n\x1a\nproof"), "receipt.png")},
        headers=owner_headers,
        content_type="multipart/form-data",
    )
    assert uploaded.status_code == 201
    payload = record_payload(player, reference="OWNER-PROOF-1")
    payload["proof"] = uploaded.json["data"]["proof"]

    forbidden = client.post("/api/payments/payments", json=payload, headers=other_headers)
    accepted = client.post("/api/payments/payments", json=payload, headers=owner_headers)
    assert forbidden.status_code == 403
    assert accepted.status_code == 201


def test_player_submission_requires_verification_and_is_attributed_to_bragpay(
    app, client, create_user
):
    player = create_user("submitting-player@example.com", subscription_access=False)
    officer = create_user("reviewing-officer@example.com", role="payment_officer")
    month = current_billing_month()
    player_headers = login(client, "submitting-player@example.com")
    officer_headers = login(client, "reviewing-officer@example.com")
    payload = {
        "billing_month": month,
        "amount": "20.00",
        "payment_method": "mobile_money",
        "payment_date": f"{month}-03",
        "reference": "PLAYER-SUBMISSION-1",
        "note": "Submitted from player account",
    }

    submitted = client.post("/api/payments/submissions", json=payload, headers=player_headers)
    duplicate = client.post("/api/payments/submissions", json=payload, headers=player_headers)
    blocked = client.get("/api/dashboard/summary", headers=player_headers)

    assert submitted.status_code == 201
    assert submitted.json["data"]["payment"]["status"] == "pending_verification"
    assert duplicate.status_code == 409
    assert blocked.status_code == 403
    payment_id = submitted.json["data"]["payment"]["id"]

    verified = client.post(
        f"/api/payments/payments/{payment_id}/verify",
        headers=officer_headers,
    )
    assert verified.status_code == 200
    assert verified.json["data"]["access_activated"] is True
    assert client.get("/api/dashboard/summary", headers=player_headers).status_code == 200
    stored = db_module.get_payments_collection(config=app.config).find_one(
        {"reference": "PLAYER-SUBMISSION-1"}
    )
    assert stored["received_by"] == str(officer["_id"])
    assert stored["status"] == "verified"
    assert officer_ledger(
        app.config, str(officer["_id"]), billing_month=month
    )["total_collected_minor"] == 2000


def test_rejected_player_submission_is_preserved_and_can_be_resubmitted(
    app, client, create_user
):
    create_user("resubmit-player@example.com", subscription_access=False)
    create_user("review-officer@example.com", role="payment_officer")
    month = current_billing_month()
    player_headers = login(client, "resubmit-player@example.com")
    officer_headers = login(client, "review-officer@example.com")
    first = client.post(
        "/api/payments/submissions",
        json={
            "billing_month": month,
            "amount": "20.00",
            "payment_method": "bank_transfer",
            "payment_date": f"{month}-02",
            "reference": "PLAYER-REJECT-1",
        },
        headers=player_headers,
    ).json["data"]["payment"]

    missing_reason = client.post(
        f"/api/payments/payments/{first['id']}/reject",
        json={},
        headers=officer_headers,
    )
    rejected = client.post(
        f"/api/payments/payments/{first['id']}/reject",
        json={"reason": "Reference was not found in the bank statement."},
        headers=officer_headers,
    )
    resubmitted = client.post(
        "/api/payments/submissions",
        json={
            "billing_month": month,
            "amount": "20.00",
            "payment_method": "bank_transfer",
            "payment_date": f"{month}-04",
            "reference": "PLAYER-RESUBMIT-2",
        },
        headers=player_headers,
    )

    assert missing_reason.status_code == 422
    assert rejected.status_code == 200
    assert resubmitted.status_code == 201
    assert db_module.get_payments_collection(config=app.config).count_documents(
        {"player_id": first["player_id"], "billing_month": month}
    ) == 2


def test_only_superadmin_can_reverse_verified_remittance(app, client, create_user):
    player = create_user("remit-player@example.com")
    create_user("remit-officer@example.com", role="payment_officer")
    create_user("ordinary-admin@example.com", role="admin")
    create_user("reconcile-super@example.com", role="super_admin")
    officer_headers = login(client, "remit-officer@example.com")
    admin_headers = login(client, "ordinary-admin@example.com")
    super_headers = login(client, "reconcile-super@example.com")
    client.post(
        "/api/payments/payments",
        json=record_payload(player, reference="REMIT-REV-PAY"),
        headers=officer_headers,
    )
    remittance = client.post(
        "/api/payments/remittances",
        json={
            "billing_month": "2026-08",
            "amount": "20.00",
            "method": "bank_transfer",
            "destination": "Operations account",
            "reference": "REMIT-REV-1",
        },
        headers=officer_headers,
    ).json["data"]
    client.patch(
        f"/api/payments/remittances/{remittance['id']}",
        json={"action": "verify"},
        headers=super_headers,
    )

    assert client.patch(
        f"/api/payments/remittances/{remittance['id']}",
        json={"action": "reverse", "reason": "Bank reversal confirmed."},
        headers=admin_headers,
    ).status_code == 403
    reversed_response = client.patch(
        f"/api/payments/remittances/{remittance['id']}",
        json={"action": "reverse", "reason": "Bank reversal confirmed."},
        headers=super_headers,
    )
    assert reversed_response.status_code == 200
    assert reversed_response.json["data"]["status"] == "reversed"
