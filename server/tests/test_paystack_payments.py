import hashlib
import hmac
import json

import pytest

from app import db as db_module
from app.services.paystack_service import PaystackError, initialize_transaction
from app.services.subscription_service import (
    current_billing_month,
    pay_ahead_options,
    pay_ahead_plan,
    shift_billing_month,
)


PASSWORD = "correct-horse-battery-staple"
SECRET = "sk_test_phase_one_secret"
LIVE_SECRET = "sk_live_production_readiness_secret"


def login(client, email):
    response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json['access_token']}"}


def configure_paystack(app):
    app.config.update(
        PAYSTACK_PUBLIC_KEY="pk_test_phase_one_public",
        PAYSTACK_SECRET_KEY=SECRET,
        PAYSTACK_CALLBACK_URL="http://localhost:5173/#/payments/paystack/callback",
        SUBSCRIPTION_MONTHLY_FEE_MINOR=2000,
        SUBSCRIPTION_CURRENCY="GHS",
    )


def initialize(client, app, create_user, monkeypatch, email="payer@example.com", months=1):
    player = create_user(email, subscription_access=False)
    configure_paystack(app)
    captured = {}

    def fake_initialize(config, **payload):
        captured.update(payload)
        return {
            "authorization_url": "https://checkout.paystack.test/authorize/abc",
            "access_code": "test_access_code",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.routes.payments.initialize_transaction", fake_initialize)
    response = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": months},
        headers=login(client, email),
    )
    assert response.status_code == 201
    return player, response, captured, login(client, email)


def verified_data(reference, *, status="success", amount=2000, currency="GHS"):
    return {
        "id": 987654,
        "reference": reference,
        "status": status,
        "amount": amount,
        "currency": currency,
        "paid_at": "2026-08-07T12:00:00Z" if status == "success" else None,
    }


def signed_webhook(client, payload, secret=SECRET):
    raw = json.dumps(payload, separators=(",", ":")).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha512).hexdigest()
    return client.post(
        "/api/payments/paystack/webhook",
        data=raw,
        content_type="application/json",
        headers={"x-paystack-signature": signature},
    )


def test_monthly_subscription_maps_ghs_20_to_paystack_mobile_money_payload(monkeypatch):
    config = {
        "PAYSTACK_PUBLIC_KEY": "pk_test_phase_one_public",
        "PAYSTACK_SECRET_KEY": SECRET,
        "PAYSTACK_CALLBACK_URL": "http://localhost:5173/#/payments/paystack/callback",
    }
    captured = {}

    def fake_request(request_config, method, path, payload=None):
        captured.update({"method": method, "path": path, "payload": payload})
        return {
            "authorization_url": "https://checkout.paystack.test/authorize/price-check",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.services.paystack_service._request", fake_request)
    initialize_transaction(
        config,
        email="payer@example.com",
        amount_minor=2000,
        reference="BR-PSTK-PRICE-CHECK",
        metadata={"payment_type": "monthly_subscription"},
    )

    assert captured["method"] == "POST"
    assert captured["path"] == "/transaction/initialize"
    assert captured["payload"]["amount"] == 2000
    assert captured["payload"]["currency"] == "GHS"
    assert captured["payload"]["channels"] == ["mobile_money"]
    assert captured["payload"]["metadata"]["payment_type"] == "monthly_subscription"


def test_live_mode_maps_ghs_20_to_mobile_money_with_public_https_callback(monkeypatch):
    config = {
        "PAYSTACK_PUBLIC_KEY": "pk_live_production_readiness_public",
        "PAYSTACK_SECRET_KEY": LIVE_SECRET,
        "PAYSTACK_CALLBACK_URL": "https://bragright.example/#/payments/paystack/callback",
    }
    captured = {}

    def fake_request(request_config, method, path, payload=None):
        captured.update({"method": method, "path": path, "payload": payload})
        return {
            "authorization_url": "https://checkout.paystack.com/authorize/live-check",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.services.paystack_service._request", fake_request)
    initialize_transaction(
        config,
        email="payer@example.com",
        amount_minor=2000,
        reference="BR-PSTK-LIVE-CHECK",
        metadata={"payment_type": "monthly_subscription"},
    )

    assert captured["method"] == "POST"
    assert captured["path"] == "/transaction/initialize"
    assert captured["payload"]["amount"] == 2000
    assert captured["payload"]["currency"] == "GHS"
    assert captured["payload"]["channels"] == ["mobile_money"]
    assert captured["payload"]["callback_url"] == config["PAYSTACK_CALLBACK_URL"]


@pytest.mark.parametrize(
    ("public_key", "secret_key", "callback_url", "expected_code"),
    [
        (
            "pk_test_production_readiness_public",
            LIVE_SECRET,
            "https://bragright.example/#/payments/paystack/callback",
            "paystack_key_mode_mismatch",
        ),
        (
            "pk_live_production_readiness_public",
            LIVE_SECRET,
            "http://localhost:5173/#/payments/paystack/callback",
            "paystack_live_callback_required",
        ),
    ],
)
def test_paystack_rejects_mixed_keys_and_non_public_live_callback(
    public_key, secret_key, callback_url, expected_code
):
    with pytest.raises(PaystackError) as captured:
        initialize_transaction(
            {
                "PAYSTACK_PUBLIC_KEY": public_key,
                "PAYSTACK_SECRET_KEY": secret_key,
                "PAYSTACK_CALLBACK_URL": callback_url,
            },
            email="payer@example.com",
            amount_minor=2000,
            reference="BR-PSTK-INVALID-LIVE-CONFIG",
            metadata={"payment_type": "monthly_subscription"},
        )

    assert captured.value.code == expected_code
    assert public_key not in str(captured.value)
    assert secret_key not in str(captured.value)


def test_invalid_live_configuration_creates_no_payment_record(
    app, client, create_user
):
    email = "invalid-live-config@example.com"
    player = create_user(email, subscription_access=False)
    app.config.update(
        PAYSTACK_PUBLIC_KEY="pk_live_production_readiness_public",
        PAYSTACK_SECRET_KEY=SECRET,
        PAYSTACK_CALLBACK_URL="https://bragright.example/#/payments/paystack/callback",
    )

    response = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=login(client, email),
    )

    assert response.status_code == 503
    assert response.json["error"]["code"] == "PAYSTACK_KEY_MODE_MISMATCH"
    assert db_module.get_payments_collection(config=app.config).count_documents(
        {"player_id": str(player["_id"]), "source": "paystack"}
    ) == 0


def test_paystack_http_request_uses_bearer_auth_and_application_user_agent(monkeypatch):
    captured = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps(
                {
                    "status": True,
                    "data": {
                        "authorization_url": "https://checkout.paystack.test/authorize/http",
                        "reference": "BR-PSTK-HTTP-CHECK",
                    },
                }
            ).encode()

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["authorization"] = request.get_header("Authorization")
        captured["user_agent"] = request.get_header("User-agent")
        captured["payload"] = json.loads(request.data.decode())
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("app.services.paystack_service.urlopen", fake_urlopen)
    initialize_transaction(
        {
            "PAYSTACK_PUBLIC_KEY": "pk_test_phase_one_public",
            "PAYSTACK_SECRET_KEY": SECRET,
            "PAYSTACK_CALLBACK_URL": "http://localhost:5173/#/payments/paystack/callback",
        },
        email="player@gmail.com",
        amount_minor=2000,
        reference="BR-PSTK-HTTP-CHECK",
        metadata={"payment_type": "monthly_subscription"},
    )
    assert captured["url"] == "https://api.paystack.co/transaction/initialize"
    assert captured["authorization"] == f"Bearer {SECRET}"
    assert captured["user_agent"] == "BragRight-Payments/1.0"
    assert captured["payload"]["amount"] == 2000
    assert captured["payload"]["currency"] == "GHS"
    assert captured["payload"]["channels"] == ["mobile_money"]


@pytest.mark.parametrize(
    ("months", "expected_minor"),
    [(1, 2000), (2, 4000), (3, 6000), (6, 12000), (12, 24000)],
)
def test_pay_ahead_pricing_is_authoritative(
    app, client, create_user, monkeypatch, months, expected_minor
):
    _, response, captured, _ = initialize(
        client, app, create_user, monkeypatch, months=months
    )
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"reference": response.json["data"]["reference"]}
    )
    assert captured["amount_minor"] == expected_minor
    assert payment["monthly_rate_minor"] == 2000
    assert payment["amount_minor"] == expected_minor
    assert payment["months"] == months
    assert len(payment["covered_periods"]) == months
    assert payment["currency"] == "GHS"


@pytest.mark.parametrize("months", [0, 4, 13, "3", 3.0, True])
def test_pay_ahead_rejects_unsupported_months(app, client, create_user, months):
    configure_paystack(app)
    create_user("invalid-months@example.com", subscription_access=False)
    response = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": months},
        headers=login(client, "invalid-months@example.com"),
    )
    assert response.status_code == 422
    assert response.json["error"]["code"] == "INVALID_SUBSCRIPTION_MONTHS"


def test_pay_ahead_starts_after_existing_paid_period_and_is_consecutive(app, create_user):
    player = create_user("covered-player@example.com")
    plan = pay_ahead_plan(app.config, str(player["_id"]), 3)
    expected_first = shift_billing_month(current_billing_month(), 1)
    assert plan["covered_periods"] == [
        expected_first,
        shift_billing_month(expected_first, 1),
        shift_billing_month(expected_first, 2),
    ]
    assert plan["paid_through_period"] == current_billing_month()


def test_active_player_subscription_api_exposes_all_pay_ahead_options(
    app, client, create_user
):
    create_user("visible-pay-ahead@example.com")
    response = client.get(
        "/api/payments/subscription/me",
        headers=login(client, "visible-pay-ahead@example.com"),
    )
    assert response.status_code == 200
    assert response.json["data"]["access"]["allowed"] is True
    assert [item["months"] for item in response.json["data"]["pay_ahead_options"]] == [1, 2, 3, 6, 12]
    assert [item["total"] for item in response.json["data"]["pay_ahead_options"]] == [20.0, 40.0, 60.0, 120.0, 240.0]


def test_pay_ahead_previews_share_one_allocation_scan(app, create_user, monkeypatch):
    player = create_user("fast-preview@example.com", subscription_access=False)
    from app.services import subscription_service

    real_check = subscription_service._period_is_satisfied
    checks = []

    def counted_check(config, player_id, billing_month):
        checks.append(billing_month)
        return real_check(config, player_id, billing_month)

    monkeypatch.setattr(subscription_service, "_period_is_satisfied", counted_check)
    options = pay_ahead_options(app.config, str(player["_id"]))

    assert [option["months"] for option in options] == [1, 2, 3, 6, 12]
    assert [option["total_minor"] for option in options] == [2000, 4000, 6000, 12000, 24000]
    assert len(checks) == 13


def test_initialize_is_authenticated_validates_type_and_ignores_client_amount(
    app, client, create_user, monkeypatch
):
    configure_paystack(app)
    assert client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription"},
    ).status_code == 401

    create_user("invalid@example.com", subscription_access=False)
    headers = login(client, "invalid@example.com")
    invalid = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "match_entry"},
        headers=headers,
    )
    manipulated = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "amount": 1},
        headers=headers,
    )
    manipulated_minor = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 3, "amount_minor": 1},
        headers=headers,
    )
    assert invalid.status_code == 422
    assert invalid.json["error"]["code"] == "INVALID_PAYMENT_TYPE"
    assert manipulated.status_code == 422
    assert manipulated_minor.status_code == 422

    player, response, captured, _ = initialize(client, app, create_user, monkeypatch)
    assert response.json["data"]["authorization_url"].startswith("https://checkout.paystack.test/")
    assert captured["amount_minor"] == 2000
    assert captured["metadata"]["player_id"] == str(player["_id"])
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"reference": response.json["data"]["reference"]}
    )
    assert payment["purpose"] == "1-Month BragRight subscription"
    assert payment["amount_minor"] == 2000
    assert payment["currency"] == "GHS"
    assert payment["payment_method"] == "mobile_money"
    assert payment["paid_at"] is None
    assert payment["verified_at"] is None
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, status="pending"),
    )
    repeated = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription"},
        headers=login(client, "payer@example.com"),
    )
    assert repeated.status_code == 200
    assert repeated.json["data"]["reference"] == payment["reference"]


def test_completed_checkout_is_fulfilled_and_next_payment_gets_fresh_reference_and_link(
    app, client, create_user, monkeypatch
):
    player = create_user("fresh-next-payment@example.com", subscription_access=False)
    configure_paystack(app)
    headers = login(client, "fresh-next-payment@example.com")
    initialized_references = []

    def fake_initialize(config, **payload):
        initialized_references.append(payload["reference"])
        return {
            "authorization_url": f"https://checkout.paystack.test/authorize/{payload['reference']}",
            "access_code": f"access-{len(initialized_references)}",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.routes.payments.initialize_transaction", fake_initialize)
    first = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )
    first_reference = first.json["data"]["reference"]
    first_url = first.json["data"]["authorization_url"]
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value),
    )

    second = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )
    second_reference = second.json["data"]["reference"]
    second_url = second.json["data"]["authorization_url"]
    payments = list(
        db_module.get_payments_collection(config=app.config)
        .find({"player_id": str(player["_id"]), "source": "paystack"})
        .sort("created_at", 1)
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert first_reference != second_reference
    assert first_url != second_url
    assert initialized_references == [first_reference, second_reference]
    assert len(payments) == 2
    assert payments[0]["status"] == "verified"
    assert payments[0]["fulfilled_at"] is not None
    assert payments[1]["first_covered_period"] == shift_billing_month(
        payments[0]["last_covered_period"], 1
    )


def test_initialization_failure_retry_preserves_obligation_and_reference(
    app, client, create_user, monkeypatch
):
    player = create_user("retry-initialization@example.com", subscription_access=False)
    configure_paystack(app)
    headers = login(client, "retry-initialization@example.com")
    calls = []

    def fail_then_succeed(config, **payload):
        calls.append(payload["reference"])
        if len(calls) == 1:
            raise PaystackError("Paystack rejected the transaction request.")
        return {
            "authorization_url": f"https://checkout.paystack.test/authorize/{payload['reference']}",
            "access_code": "retry-access",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.routes.payments.initialize_transaction", fail_then_succeed)
    first = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 2},
        headers=headers,
    )
    stored_after_failure = db_module.get_payments_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "source": "paystack"}
    )
    retry = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 2},
        headers=headers,
    )
    stored_after_retry = db_module.get_payments_collection(config=app.config).find_one(
        {"_id": stored_after_failure["_id"]}
    )

    assert first.status_code == 502
    assert stored_after_failure["status"] == "initialization_failed"
    assert retry.status_code == 201
    assert calls[0] == calls[1]
    assert retry.json["data"]["reference"] == stored_after_failure["reference"]
    assert stored_after_retry["status"] == "paystack_initialized"
    assert stored_after_retry["covered_periods"] == stored_after_failure["covered_periods"]


def test_unknown_initialization_outcome_rotates_only_after_provider_reports_missing(
    app, client, create_user, monkeypatch
):
    player = create_user("unknown-initialization@example.com", subscription_access=False)
    configure_paystack(app)
    headers = login(client, "unknown-initialization@example.com")
    calls = []

    def unknown_then_succeed(config, **payload):
        calls.append(payload["reference"])
        if len(calls) == 1:
            raise PaystackError(
                "Paystack could not be reached. Please try again.",
                outcome_unknown=True,
            )
        return {
            "authorization_url": f"https://checkout.paystack.test/authorize/{payload['reference']}",
            "access_code": "unknown-retry-access",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.routes.payments.initialize_transaction", unknown_then_succeed)
    first = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )
    first_payment = db_module.get_payments_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "source": "paystack"}
    )
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: (_ for _ in ()).throw(
            PaystackError("Transaction was not found.", provider_status=404)
        ),
    )
    retry = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )

    assert first.status_code == 502
    assert first_payment["initialization_outcome_unknown"] is True
    assert retry.status_code == 201
    assert calls[0] != calls[1]
    assert retry.json["data"]["reference"] == calls[1]


def test_restart_before_checkout_url_is_stored_reconciles_reference_before_retry(
    app, client, create_user, monkeypatch
):
    _, initialized, _, headers = initialize(
        client, app, create_user, monkeypatch, email="restart-retry@example.com"
    )
    reference = initialized.json["data"]["reference"]
    payments = db_module.get_payments_collection(config=app.config)
    payments.update_one(
        {"paystack_reference": reference},
        {"$set": {"status": "paystack_pending"}, "$unset": {"authorization_url": ""}},
    )
    verification_calls = []
    initialization_calls = []

    def provider_reports_missing(config, value):
        verification_calls.append(value)
        raise PaystackError("Transaction was not found.", provider_status=404)

    def reinitialize(config, **payload):
        initialization_calls.append(payload["reference"])
        return {
            "authorization_url": f"https://checkout.paystack.test/authorize/{payload['reference']}",
            "access_code": "restart-retry-access",
            "reference": payload["reference"],
        }

    monkeypatch.setattr("app.routes.payments.verify_transaction", provider_reports_missing)
    monkeypatch.setattr("app.routes.payments.initialize_transaction", reinitialize)
    retry = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )

    assert retry.status_code == 201
    assert verification_calls == [reference]
    assert initialization_calls == [reference]
    assert retry.json["data"]["reference"] == reference


def test_restart_does_not_reinitialize_reference_that_paystack_is_processing(
    app, client, create_user, monkeypatch
):
    _, initialized, _, headers = initialize(
        client, app, create_user, monkeypatch, email="restart-pending@example.com"
    )
    reference = initialized.json["data"]["reference"]
    payments = db_module.get_payments_collection(config=app.config)
    payments.update_one(
        {"paystack_reference": reference},
        {"$set": {"status": "paystack_pending"}, "$unset": {"authorization_url": ""}},
    )
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, status="pending"),
    )
    monkeypatch.setattr(
        "app.routes.payments.initialize_transaction",
        lambda *args, **kwargs: pytest.fail("pending reference must not be initialized twice"),
    )

    retry = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )

    assert retry.status_code == 409
    assert retry.json["error"]["code"] == "PAYSTACK_INITIALIZATION_PENDING"
    assert payments.find_one({"paystack_reference": reference})["fulfilled_at"] is None


def test_callback_verifies_server_side_and_fulfills_subscription_once(
    app, client, create_user, monkeypatch
):
    player, initialized, _, headers = initialize(client, app, create_user, monkeypatch)
    reference = initialized.json["data"]["reference"]
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value),
    )

    response = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    replay = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    subscription = db_module.get_subscriptions_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "billing_month": current_billing_month()}
    )
    assert response.status_code == 200
    assert response.json["data"]["payment"]["status"] == "verified"
    assert replay.status_code == 200
    assert subscription["status"] == "active"
    assert db_module.get_financial_audit_logs_collection(config=app.config).count_documents(
        {"action": "paystack_payment_verified"}
    ) == 1


def test_multi_month_fulfillment_activates_every_period_without_double_extension(
    app, client, create_user, monkeypatch
):
    player, initialized, _, headers = initialize(
        client, app, create_user, monkeypatch, months=3
    )
    reference = initialized.json["data"]["reference"]
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, amount=6000),
    )

    callback = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    webhook = signed_webhook(
        client, {"event": "charge.success", "data": {"reference": reference}}
    )
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"paystack_reference": reference}
    )
    subscriptions = list(
        db_module.get_subscriptions_collection(config=app.config).find(
            {"player_id": str(player["_id"]), "billing_month": {"$in": payment["covered_periods"]}}
        )
    )

    assert callback.status_code == 200
    assert webhook.status_code == 200
    assert webhook.json["data"]["duplicate"] is True
    assert payment["fulfilled_periods"] == payment["covered_periods"]
    assert payment["paid_through_period"] == payment["last_covered_period"]
    assert len(subscriptions) == 3
    assert {item["billing_month"] for item in subscriptions} == set(payment["covered_periods"])
    assert all(item["status"] == "active" for item in subscriptions)
    assert all(item["amount_paid_minor"] == 2000 for item in subscriptions)

    status = client.get("/api/payments/subscription/me", headers=headers)
    history = client.get("/api/payments/history", headers=headers)
    assert status.status_code == 200
    assert status.json["data"]["access"]["allowed"] is True
    assert status.json["data"]["pay_ahead_options"][0]["paid_through_period"] == payment["last_covered_period"]
    assert history.json["data"]["payments"][0]["months"] == 3
    assert history.json["data"]["payments"][0]["covered_periods"] == payment["covered_periods"]

    next_plan = pay_ahead_plan(app.config, str(player["_id"]), 2)
    assert next_plan["first_covered_period"] == shift_billing_month(
        payment["last_covered_period"], 1
    )


def test_pay_ahead_preserves_existing_active_access(
    app, client, create_user, monkeypatch
):
    player = create_user("active-pay-ahead@example.com")
    configure_paystack(app)
    headers = login(client, "active-pay-ahead@example.com")
    monkeypatch.setattr(
        "app.routes.payments.initialize_transaction",
        lambda config, **payload: {
            "authorization_url": "https://checkout.paystack.test/authorize/active",
            "access_code": "active_access_code",
            "reference": payload["reference"],
        },
    )
    initialized = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 2},
        headers=headers,
    )
    reference = initialized.json["data"]["reference"]
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, amount=4000),
    )
    verified = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    current_subscription = db_module.get_subscriptions_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "billing_month": current_billing_month()}
    )
    assert initialized.status_code == 201
    assert verified.status_code == 200
    assert current_subscription["status"] == "exempted"
    assert client.get("/api/payments/subscription/me", headers=headers).json["data"]["access"]["allowed"] is True


def test_partial_fulfillment_retry_repairs_same_periods(
    app, client, create_user, monkeypatch
):
    player, initialized, _, headers = initialize(
        client, app, create_user, monkeypatch, months=3
    )
    reference = initialized.json["data"]["reference"]
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, amount=6000),
    )
    from app.routes import payments as payments_routes

    real_recalculate = payments_routes.recalculate_subscription
    calls = {"count": 0}

    def interrupt_once(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 2:
            raise RuntimeError("simulated interruption")
        return real_recalculate(*args, **kwargs)

    monkeypatch.setattr(payments_routes, "recalculate_subscription", interrupt_once)
    interrupted = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    assert interrupted.status_code == 500
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"paystack_reference": reference}
    )
    assert payment["fulfilled_at"] is None
    assert payment.get("paid_through_period") is None

    monkeypatch.setattr(payments_routes, "recalculate_subscription", real_recalculate)
    repaired = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"paystack_reference": reference}
    )
    subscriptions = list(
        db_module.get_subscriptions_collection(config=app.config).find(
            {"player_id": str(player["_id"]), "billing_month": {"$in": payment["covered_periods"]}}
        )
    )
    assert repaired.status_code == 200
    assert payment["fulfilled_periods"] == payment["covered_periods"]
    assert len(subscriptions) == 3
    assert all(item["status"] == "active" for item in subscriptions)


def test_fulfillment_refuses_a_period_satisfied_after_checkout_started(
    app, client, create_user, monkeypatch
):
    player, initialized, _, headers = initialize(
        client, app, create_user, monkeypatch, months=2
    )
    reference = initialized.json["data"]["reference"]
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"paystack_reference": reference}
    )
    first_period = payment["covered_periods"][0]
    subscription = db_module.get_subscriptions_collection(config=app.config).find_one(
        {"player_id": str(player["_id"]), "billing_month": first_period}
    )
    db_module.get_subscriptions_collection(config=app.config).update_one(
        {"_id": subscription["_id"]},
        {"$set": {"status": "active", "payment_id": "another-payment"}},
    )
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, amount=4000),
    )
    response = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    stored = db_module.get_payments_collection(config=app.config).find_one(
        {"paystack_reference": reference}
    )
    assert response.status_code == 409
    assert response.json["error"]["code"] == "SUBSCRIPTION_PERIOD_ALREADY_FULFILLED"
    assert stored["fulfilled_at"] is None
    assert stored["status"] == "paystack_initialized"


def test_valid_webhook_rejects_forgery_and_duplicate_fulfillment(
    app, client, create_user, monkeypatch
):
    _, initialized, _, _ = initialize(client, app, create_user, monkeypatch)
    reference = initialized.json["data"]["reference"]
    payload = {"event": "charge.success", "data": {"reference": reference}}
    raw = json.dumps(payload).encode()
    forged = client.post(
        "/api/payments/paystack/webhook",
        data=raw,
        content_type="application/json",
        headers={"x-paystack-signature": "forged"},
    )
    assert forged.status_code == 401

    calls = []
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: calls.append(value) or verified_data(value),
    )
    first = signed_webhook(client, payload)
    duplicate = signed_webhook(client, payload)
    assert first.status_code == 200
    assert first.json["data"]["processed"] is True
    assert duplicate.status_code == 200
    assert duplicate.json["data"]["duplicate"] is True
    assert calls == [reference]


def test_live_webhook_signature_is_verified_with_live_secret(
    app, client, create_user, monkeypatch
):
    _, initialized, _, _ = initialize(client, app, create_user, monkeypatch)
    reference = initialized.json["data"]["reference"]
    db_module.get_payments_collection(config=app.config).update_one(
        {"paystack_reference": reference},
        {"$set": {"provider_mode": "live"}},
    )
    app.config.update(
        PAYSTACK_PUBLIC_KEY="pk_live_production_readiness_public",
        PAYSTACK_SECRET_KEY=LIVE_SECRET,
        PAYSTACK_CALLBACK_URL="https://bragright.example/#/payments/paystack/callback",
    )
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value),
    )

    response = signed_webhook(
        client,
        {"event": "charge.success", "data": {"reference": reference}},
        secret=LIVE_SECRET,
    )

    assert response.status_code == 200
    assert response.json["data"]["processed"] is True


@pytest.mark.parametrize("terminal_status", ["failed", "abandoned", "reversed"])
def test_verification_rejects_amount_and_currency_mismatch_and_handles_terminal_status(
    app, client, create_user, monkeypatch, terminal_status
):
    _, initialized, _, headers = initialize(client, app, create_user, monkeypatch)
    reference = initialized.json["data"]["reference"]
    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, amount=1),
    )
    mismatch = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    payment = db_module.get_payments_collection(config=app.config).find_one(
        {"paystack_reference": reference}
    )
    assert mismatch.status_code == 502
    assert mismatch.json["error"]["code"] == "AMOUNT_MISMATCH"
    assert payment["fulfilled_at"] is None

    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, status="pending"),
    )
    pending = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    assert pending.status_code == 200
    assert pending.json["data"]["payment"]["status"] == "paystack_initialized"

    monkeypatch.setattr(
        "app.routes.payments.verify_transaction",
        lambda config, value: verified_data(value, status=terminal_status),
    )
    terminal = client.get(
        f"/api/payments/paystack/verify?reference={reference}", headers=headers
    )
    assert terminal.status_code == 200
    assert terminal.json["data"]["payment"]["status"] == "failed"

    retry = client.post(
        "/api/payments/paystack/initialize",
        json={"payment_type": "monthly_subscription", "months": 1},
        headers=headers,
    )
    retried_payment = db_module.get_payments_collection(config=app.config).find_one(
        {"_id": payment["_id"]}
    )
    assert retry.status_code == 201
    assert retry.json["data"]["reference"] != reference
    assert reference in retried_payment["previous_paystack_references"]
    assert retried_payment["authorization_url"] == retry.json["data"]["authorization_url"]


def test_payment_history_is_authenticated_and_player_scoped(
    app, client, create_user, monkeypatch
):
    _, initialized, _, headers = initialize(client, app, create_user, monkeypatch)
    reference = initialized.json["data"]["reference"]
    assert client.get("/api/payments/history").status_code == 401
    response = client.get("/api/payments/history", headers=headers)
    assert response.status_code == 200
    history = response.json["data"]["payments"]
    assert len(history) == 1
    assert history[0]["purpose"] == "1-Month BragRight subscription"
    assert history[0]["months"] == 1
    assert history[0]["amount"] == 20.0
    assert history[0]["currency"] == "GHS"
    assert history[0]["status"] == "paystack_initialized"
    assert history[0]["reference"] == reference
    assert history[0]["first_covered_period"] == current_billing_month()
    assert history[0]["last_covered_period"] == current_billing_month()
