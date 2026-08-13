import ipaddress
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
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


def paystack_credentials(config):
    public_key = str(config.get("PAYSTACK_PUBLIC_KEY") or "").strip()
    secret_key = str(config.get("PAYSTACK_SECRET_KEY") or "").strip()
    if not public_key or not secret_key:
        raise PaystackError(
            "Paystack checkout is not configured.",
            code="paystack_not_configured",
            status_code=503,
        )
    public_mode = next(
        (mode for mode in ("test", "live") if public_key.startswith(f"pk_{mode}_")),
        None,
    )
    secret_mode = next(
        (mode for mode in ("test", "live") if secret_key.startswith(f"sk_{mode}_")),
        None,
    )
    if not public_mode or not secret_mode:
        raise PaystackError(
            "Paystack keys are invalid.",
            code="paystack_invalid_keys",
            status_code=503,
        )
    if public_mode != secret_mode:
        raise PaystackError(
            "Paystack public and secret keys must use the same environment.",
            code="paystack_key_mode_mismatch",
            status_code=503,
        )
    return secret_key, public_mode


def paystack_config(config):
    secret_key, mode = paystack_credentials(config)
    callback_url = str(config.get("PAYSTACK_CALLBACK_URL") or "").strip()
    try:
        parsed_callback = urlsplit(callback_url)
    except ValueError as error:
        raise PaystackError(
            "Paystack callback URL is invalid.",
            code="paystack_invalid_callback_url",
            status_code=503,
        ) from error
    if (
        parsed_callback.scheme not in {"http", "https"}
        or not parsed_callback.hostname
        or parsed_callback.username
        or parsed_callback.password
    ):
        raise PaystackError(
            "Paystack callback URL is invalid.",
            code="paystack_invalid_callback_url",
            status_code=503,
        )
    if mode == "live":
        hostname = parsed_callback.hostname.lower()
        try:
            is_loopback = ipaddress.ip_address(hostname).is_loopback
        except ValueError:
            is_loopback = hostname == "localhost" or hostname.endswith(".localhost")
        if parsed_callback.scheme != "https" or is_loopback:
            raise PaystackError(
                "Paystack Live Mode requires a public HTTPS callback URL.",
                code="paystack_live_callback_required",
                status_code=503,
            )
    return secret_key, callback_url, mode


def _request(config, method, path, payload=None):
    secret_key, _ = paystack_credentials(config)
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
    _, callback_url, _ = paystack_config(config)
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
