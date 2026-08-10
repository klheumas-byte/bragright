import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import DashboardLayout from "../layouts/DashboardLayout";
import { verifyPaystackPayment } from "../services/api";

export default function PaystackCallback() {
  const [searchParams] = useSearchParams();
  const outerSearchParams = new URLSearchParams(window.location.search);
  const reference = searchParams.get("reference") || searchParams.get("trxref")
    || outerSearchParams.get("reference") || outerSearchParams.get("trxref") || "";
  const [state, setState] = useState({ status: "processing", title: "Processing Payment", message: "Confirming your payment securely…", payment: null });

  useEffect(() => {
    let active = true;
    if (!reference) {
      setState({ status: "error", title: "Payment Failed", message: "The payment reference is missing.", payment: null });
      return () => { active = false; };
    }
    verifyPaystackPayment(reference)
      .then((response) => {
        if (!active) return;
        const payment = response.data?.payment;
        if (payment?.status === "verified") {
          setState({ status: "success", title: "Payment Successful", message: "Your subscription payment was verified.", payment });
        } else if (["failed", "initialization_failed", "reversed"].includes(payment?.status)) {
          setState({ status: "error", title: "Payment Failed", message: "Paystack did not complete this payment. Start a new checkout from your Subscription page.", payment: null });
        } else {
          setState({ status: "pending", title: "Payment Pending", message: "Your payment is still pending. We’ll update it after Paystack confirms it.", payment: null });
        }
      })
      .catch((error) => active && setState({ status: "error", title: "Payment Failed", message: error.message, payment: null }));
    return () => { active = false; };
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
        {state.status !== "processing" ? <Link className="ui-button ui-button--primary" to="/payments/status">View payment history</Link> : null}
      </section>
    </DashboardLayout>
  );
}

function formatMoney(value, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value || 0));
}

function formatCoverage(payment) {
  const first = formatPeriod(payment?.first_covered_period || payment?.billing_month);
  const last = formatPeriod(payment?.last_covered_period || payment?.billing_month);
  return first === last ? first : `${first} – ${last}`;
}

function formatPeriod(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) return "Unavailable";
  return new Intl.DateTimeFormat("en-GH", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}
