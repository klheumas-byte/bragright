import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


PAYSTACK_API_BASE = "https://api.paystack.co"


class PaystackError(RuntimeError):
    def __init__(
        self,
        message,
        *,
        code="paystack_error",
        status_code=502,
        provider_status=None,
        outcome_unknown=False,
    ):
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.provider_status = provider_status
        self.outcome_unknown = outcome_unknown


def _test_config(config):
    public_key = str(config.get("PAYSTACK_PUBLIC_KEY") or "").strip()
    secret_key = str(config.get("PAYSTACK_SECRET_KEY") or "").strip()
    callback_url = str(config.get("PAYSTACK_CALLBACK_URL") or "").strip()
    if not public_key or not secret_key or not callback_url:
        raise PaystackError(
            "Paystack test checkout is not configured.",
            code="paystack_not_configured",
            status_code=503,
        )
    if not public_key.startswith("pk_test_") or not secret_key.startswith("sk_test_"):
        raise PaystackError(
            "Only Paystack test keys are allowed in Phase 1.",
            code="paystack_test_mode_required",
            status_code=503,
        )
    return secret_key, callback_url


def _request(config, method, path, payload=None):
    secret_key, _ = _test_config(config)
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        f"{PAYSTACK_API_BASE}{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {secret_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "BragRight-Payments/1.0",
        },
    )
    try:
        with urlopen(request, timeout=15) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8")).get("message")
        except (ValueError, AttributeError):
            detail = None
        raise PaystackError(
            detail or "Paystack rejected the transaction request.",
            provider_status=error.code,
        ) from error
    except (URLError, TimeoutError) as error:
        raise PaystackError(
            "Paystack could not be reached. Please try again.",
            outcome_unknown=True,
        ) from error
    except ValueError as error:
        raise PaystackError(
            "Paystack returned an unreadable response. Please try again.",
            outcome_unknown=True,
        ) from error
    if not result.get("status") or not isinstance(result.get("data"), dict):
        raise PaystackError(result.get("message") or "Paystack returned an invalid response.")
    return result["data"]


def initialize_transaction(config, *, email, amount_minor, reference, metadata):
    _, callback_url = _test_config(config)
    return _request(
        config,
        "POST",
        "/transaction/initialize",
        {
            "email": email,
            "amount": int(amount_minor),
            "currency": "GHS",
            "reference": reference,
            "channels": ["mobile_money"],
            "callback_url": callback_url,
            "metadata": metadata,
        },
    )


def verify_transaction(config, reference):
    return _request(config, "GET", f"/transaction/verify/{quote(str(reference), safe='')}")
