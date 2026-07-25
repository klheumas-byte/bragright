import { useEffect, useState } from "react";
import Button from "../components/ui/Button";
import DashboardLayout from "../layouts/DashboardLayout";
import { getSubscriptionStatus, submitPlayerPayment, uploadPaymentProof } from "../services/api";

export default function SubscriptionStatus() {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const [feedback, setFeedback] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    billing_month: "",
    amount: "",
    payment_method: "mobile_money",
    transaction_reference: "",
    payment_date: new Date().toISOString().slice(0, 10),
    proof: "",
    note: "",
  });

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await getSubscriptionStatus();
      setState({ loading: false, error: "", data: response.data });
      setForm((current) => ({
        ...current,
        billing_month: response.data?.subscription?.billing_month || new Date().toISOString().slice(0, 7),
        amount: Number(response.data?.subscription?.amount_due ?? response.data?.settings?.monthly_fee ?? 0).toFixed(2),
      }));
    } catch (error) {
      setState({ loading: false, error: error.message, data: null });
    }
  }

  const subscription = state.data?.subscription;
  const access = state.data?.access;
  const settings = state.data?.settings;
  const hasPendingSubmission = state.data?.payments?.some(
    (payment) => payment.billing_month === subscription?.billing_month && payment.status === "pending_verification",
  );

  async function uploadProof(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const response = await uploadPaymentProof(file);
      setForm((current) => ({ ...current, proof: response.data?.proof || "" }));
      setFeedback("Proof uploaded securely.");
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function submitPayment(event) {
    event.preventDefault();
    setSaving(true);
    setFeedback("");
    try {
      const response = await submitPlayerPayment({
        billing_month: form.billing_month,
        amount: form.amount,
        payment_method: form.payment_method,
        payment_date: form.payment_date,
        reference: form.transaction_reference,
        proof: form.proof,
        note: form.note,
      });
      setFeedback(response.message || "Payment submitted for verification.");
      await loadStatus();
    } catch (error) {
      setFeedback(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardLayout
      title="Subscription & Payments"
      description="Review monthly access, payment instructions, submissions, and receipts."
      showBackButton={false}
    >
      <section className="feature-hero-card subscription-hero">
        <div>
          <p className="section-label">Monthly membership</p>
          <h2 className="feature-hero-title">
            {access?.allowed ? "Your account has access." : "Payment is required."}
          </h2>
          <p>The monthly fee is {formatMoney(settings?.monthly_fee, settings?.currency)}.</p>
        </div>
        <span className={`ui-badge ui-badge--${statusTone(access?.status)}`}>
          {formatStatus(access?.status || "payment_due")}
        </span>
      </section>

      {state.error ? (
        <div className="ui-alert ui-alert--danger" role="alert">
          <p>{state.error}</p>
          <Button variant="secondary" onClick={loadStatus}>Try again</Button>
        </div>
      ) : null}

      {state.loading ? (
        <div className="dashboard-panel skeleton" role="status">Loading subscription…</div>
      ) : (
        <div className="subscription-layout">
          <section className="dashboard-panel">
            <div className="panel-header">
              <div><p className="panel-kicker">Current period</p><h2 className="panel-title">Account status</h2></div>
            </div>
            <dl className="financial-detail-grid">
              <div><dt>Billing month</dt><dd>{subscription?.billing_month || "Not generated yet"}</dd></div>
              <div><dt>Amount due</dt><dd>{formatMoney(subscription?.amount_due ?? settings?.monthly_fee, settings?.currency)}</dd></div>
              <div><dt>Amount paid</dt><dd>{formatMoney(subscription?.amount_paid || 0, settings?.currency)}</dd></div>
              <div><dt>Due date</dt><dd>{formatDate(subscription?.due_date)}</dd></div>
              <div><dt>Grace period ends</dt><dd>{formatDate(subscription?.grace_ends_at)}</dd></div>
              <div><dt>Paid through</dt><dd>{formatDate(subscription?.expires_at)}</dd></div>
            </dl>
            {!access?.allowed ? (
              <div className="ui-alert ui-alert--warning">
                <strong>Limited access</strong>
                <p>{state.data?.instructions}</p>
              </div>
            ) : null}
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div><p className="panel-kicker">Payment instructions</p><h2 className="panel-title">Pay your subscription</h2></div>
            </div>
            <p>{state.data?.instructions}</p>
            <dl className="financial-detail-grid">
              <div><dt>Destination</dt><dd>{state.data?.payment_destination || "Contact BragPay"}</dd></div>
              <div><dt>Support</dt><dd>{state.data?.support_contact || "Contact BragRight support"}</dd></div>
            </dl>
            {feedback ? <div className="ui-alert ui-alert--warning" role="status">{feedback}</div> : null}
            {!access?.allowed && !hasPendingSubmission ? (
              <form className="financial-form" onSubmit={submitPayment}>
                <div className="financial-form-grid">
                  <label>Billing month<input className="ui-input" type="month" value={form.billing_month} onChange={(event) => setForm((current) => ({ ...current, billing_month: event.target.value }))} required /></label>
                  <label>Amount ({settings?.currency || "GHS"})<input className="ui-input" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} required /></label>
                  <label>Method<select className="ui-select" value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))}>{["mobile_money", "bank_transfer", "bank_deposit", "cash", "other"].map((method) => <option key={method} value={method}>{formatStatus(method)}</option>)}</select></label>
                  <label>Payment date<input className="ui-input" type="date" value={form.payment_date} onChange={(event) => setForm((current) => ({ ...current, payment_date: event.target.value }))} required /></label>
                  <label>Transaction reference<input className="ui-input" value={form.transaction_reference} onChange={(event) => setForm((current) => ({ ...current, transaction_reference: event.target.value }))} maxLength="100" required={form.payment_method !== "cash"} /></label>
                  <label>Proof attachment<input className="ui-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProof} />{form.proof ? <small>Proof attached</small> : null}</label>
                </div>
                <label>Optional note<textarea className="ui-textarea" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} maxLength="500" /></label>
                <Button type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit payment for verification"}</Button>
              </form>
            ) : hasPendingSubmission ? (
              <div className="ui-alert ui-alert--warning"><strong>Pending verification</strong><p>BragPay will review your submitted payment. Access is not unlocked until it is verified.</p></div>
            ) : null}
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div><p className="panel-kicker">Receipts</p><h2 className="panel-title">Payment history</h2></div>
            </div>
            {state.data?.payments?.length ? (
              <div className="financial-card-list">
                {state.data.payments.map((payment) => (
                  <article className="financial-record-card" key={payment.id}>
                    <div><strong>{formatMoney(payment.amount, payment.currency)}</strong><span>{payment.billing_month}</span></div>
                    <span className={`ui-badge ui-badge--${statusTone(payment.status)}`}>{formatStatus(payment.status)}</span>
                    <small>{formatStatus(payment.payment_method)} · {payment.reference || "Cash payment"} · {formatDate(payment.payment_date)}</small>
                    {payment.rejection_reason ? <small>Reason: {payment.rejection_reason}</small> : null}
                  </article>
                ))}
              </div>
            ) : <p className="empty-state-copy">No payments have been recorded yet.</p>}
          </section>
        </div>
      )}
    </DashboardLayout>
  );
}

function formatMoney(value, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: currency || "GHS" }).format(Number(value || 0));
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value)) : "—";
}

function formatStatus(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status) {
  if (["active", "verified", "recorded", "exempted"].includes(status)) return "success";
  if (["restricted", "expired", "reversed", "rejected", "suspended"].includes(status)) return "danger";
  return "warning";
}
