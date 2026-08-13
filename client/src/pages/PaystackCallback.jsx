import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DashboardLayout from "../layouts/DashboardLayout";
import { verifyPaystackPayment } from "../services/api";

const CONFIRMATION_POLL_INTERVAL_MS = 5_000;
const CONFIRMATION_TIMEOUT_MS = 75_000;
const PENDING_PROVIDER_STATUSES = new Set(["pending", "ongoing", "processing", "queued"]);
const TERMINAL_PROVIDER_STATUSES = new Set(["failed", "abandoned", "reversed"]);

export default function PaystackCallback() {
  const [searchParams] = useSearchParams();
  const outerSearchParams = new URLSearchParams(window.location.search);
  const reference = searchParams.get("reference") || searchParams.get("trxref")
    || outerSearchParams.get("reference") || outerSearchParams.get("trxref") || "";
  const checkStatusRef = useRef(null);
  const [state, setState] = useState({
    status: "processing",
    title: "Processing Payment",
    message: "Confirming your payment securely...",
    payment: null,
    checking: false,
  });

  useEffect(() => {
    let active = true;
    let pollTimer = null;
    let requestInFlight = false;
    const startedAt = Date.now();

    if (!reference) {
      setState({ status: "error", title: "Payment Failed", message: "The payment reference is missing.", payment: null, checking: false });
      return () => { active = false; };
    }

    const showStillConfirming = () => setState({
      status: "still_confirming",
      title: "Still confirming",
      message: "Paystack has not confirmed a final result yet. You can check again safely.",
      payment: null,
      checking: false,
    });

    const scheduleNextCheck = (checkPayment) => {
      const remaining = CONFIRMATION_TIMEOUT_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        showStillConfirming();
        return;
      }
      pollTimer = window.setTimeout(checkPayment, Math.min(CONFIRMATION_POLL_INTERVAL_MS, remaining));
    };

    const checkPayment = async ({ manual = false } = {}) => {
      if (!active || requestInFlight) return;
      requestInFlight = true;
      if (manual) setState((current) => ({ ...current, checking: true }));

      try {
        const response = await verifyPaystackPayment(reference);
        if (!active) return;
        const payment = response.data?.payment;
        const nextState = paymentState(payment);
        if (nextState.status === "success" || nextState.status === "error") {
          setState(nextState);
        } else if (manual || Date.now() - startedAt >= CONFIRMATION_TIMEOUT_MS) {
          showStillConfirming();
        } else {
          setState(nextState);
          scheduleNextCheck(checkPayment);
        }
      } catch (error) {
        if (!active) return;
        if (manual || Date.now() - startedAt >= CONFIRMATION_TIMEOUT_MS) {
          showStillConfirming();
        } else {
          setState({
            status: "pending",
            title: "Payment Pending",
            message: "Confirmation is temporarily unavailable. BragRight will check again automatically.",
            payment: null,
            checking: false,
          });
          scheduleNextCheck(checkPayment);
        }
      } finally {
        requestInFlight = false;
      }
    };

    checkStatusRef.current = () => checkPayment({ manual: true });
    checkPayment();

    return () => {
      active = false;
      checkStatusRef.current = null;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [reference]);

  return (
    <DashboardLayout title="Payment confirmation" description="Your callback is checked against Paystack before access is granted.">
      <section className="dashboard-panel payment-callback-card" role="status" aria-live="polite">
        <p className="panel-kicker">{state.status === "processing" ? "Processing payment" : "Payment status"}</p>
        <h2 className="panel-title">{state.title}</h2>
        <p className="section-copy">{state.message}</p>
        {state.payment ? (
          <dl className="financial-detail-grid">
            <div><dt>Amount</dt><dd>{formatMoney(state.payment.amount, state.payment.currency)}</dd></div>
            <div><dt>Subscription</dt><dd>{state.payment.months || 1} {(state.payment.months || 1) === 1 ? "month" : "months"}</dd></div>
            <div><dt>Coverage</dt><dd>{formatCoverage(state.payment)}</dd></div>
            <div><dt>Paid through</dt><dd>{formatPeriod(state.payment.paid_through_period || state.payment.last_covered_period)}</dd></div>
            <div><dt>Reference</dt><dd>{state.payment.reference}</dd></div>
          </dl>
        ) : <p className="section-copy">Reference: {reference || "Unavailable"}</p>}
        {state.status === "still_confirming" ? (
          <button
            className="ui-button ui-button--primary"
            type="button"
            disabled={state.checking}
            onClick={() => checkStatusRef.current?.()}
          >
            {state.checking ? "Checking..." : "Check Status"}
          </button>
        ) : null}
        {state.status !== "processing" ? <Link className="ui-button ui-button--secondary" to="/payments/status">View payment history</Link> : null}
      </section>
    </DashboardLayout>
  );
}

function paymentState(payment) {
  const providerStatus = String(payment?.provider_status || "").toLowerCase();
  if (payment?.status === "verified" && providerStatus === "success") {
    return { status: "success", title: "Payment Successful", message: "Your subscription payment was verified.", payment, checking: false };
  }
  if (payment?.status === "failed" || TERMINAL_PROVIDER_STATUSES.has(providerStatus)) {
    const title = providerStatus === "abandoned"
      ? "Payment Abandoned"
      : providerStatus === "reversed"
        ? "Payment Reversed"
        : "Payment Failed";
    return { status: "error", title, message: "Paystack did not complete this payment. Start a new checkout from your Subscription page.", payment: null, checking: false };
  }
  const pendingStatus = PENDING_PROVIDER_STATUSES.has(providerStatus) ? providerStatus : "pending";
  return {
    status: "pending",
    title: "Payment Pending",
    message: `Paystack reports this payment as ${pendingStatus}. BragRight will keep checking securely.`,
    payment: null,
    checking: false,
  };
}

function formatMoney(value, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value || 0));
}

function formatCoverage(payment) {
  const first = formatPeriod(payment?.first_covered_period || payment?.billing_month);
  const last = formatPeriod(payment?.last_covered_period || payment?.billing_month);
  return first === last ? first : `${first} - ${last}`;
}

function formatPeriod(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) return "Unavailable";
  return new Intl.DateTimeFormat("en-GH", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}
