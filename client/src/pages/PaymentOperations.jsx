import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  getPaymentDashboard,
  getPaymentSettings,
  getPayments,
  getRemittances,
  grantSubscriptionExemption,
  recordManualPayment,
  rejectPlayerPayment,
  reverseManualPayment,
  runMonthlyBilling,
  reviewRemittance,
  searchSubscriptionPlayers,
  submitRemittance,
  uploadPaymentProof,
  verifyManualPayment,
} from "../services/api";

const monthNow = new Date().toISOString().slice(0, 7);

export default function PaymentOperations({ view = "dashboard" }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const isPaymentOfficer = user?.role === "payment_officer";
  const [month, setMonth] = useState(monthNow);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [subscriptionFilter, setSubscriptionFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [officerFilter, setOfficerFilter] = useState("all");
  const [dashboard, setDashboard] = useState({});
  const [players, setPlayers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [remittances, setRemittances] = useState([]);
  const [settings, setSettings] = useState({ monthly_fee: "", currency: "GHS" });
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [loading, setLoading] = useState(true);

  const title = view === "record" ? "Record Payment" : view === "remittances" ? "Remittances" : "Payment Dashboard";

  async function load() {
    setLoading(true);
    setFeedback({ type: "", message: "" });
    try {
      const [dashboardResult, playerResult, paymentsResult, remittanceResult, settingsResult] = await Promise.allSettled([
        getPaymentDashboard({ billing_month: month }),
        searchSubscriptionPlayers({ billing_month: month, search: debouncedSearch, subscription_status: subscriptionFilter }),
        getPayments({ billing_month: month, payment_method: methodFilter, status: paymentStatusFilter, officer_id: officerFilter, player: debouncedSearch }),
        getRemittances({ billing_month: month }),
        getPaymentSettings(),
      ]);
      if (dashboardResult.status === "fulfilled") setDashboard(dashboardResult.value.data || {});
      if (playerResult.status === "fulfilled") setPlayers(playerResult.value.data?.players || []);
      if (paymentsResult.status === "fulfilled") setPayments(paymentsResult.value.data?.payments || []);
      if (remittanceResult.status === "fulfilled") setRemittances(remittanceResult.value.data?.remittances || []);
      if (settingsResult.status === "fulfilled") setSettings(settingsResult.value.data || settings);

      const failedResult = [
        dashboardResult,
        playerResult,
        paymentsResult,
        remittanceResult,
        settingsResult,
      ].find((result) => result.status === "rejected");
      if (failedResult) {
        setFeedback({
          type: "error",
          message: failedResult.reason?.message || "Some payment information could not be loaded.",
        });
      }
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [month, debouncedSearch, subscriptionFilter, methodFilter, paymentStatusFilter, officerFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  return (
    <DashboardLayout
      title={title}
      description={isSuperAdmin ? "Oversee collections, remittances, and monthly player access." : "Record player payments and reconcile collections."}
      showBackButton={false}
    >
      <section className="financial-toolbar dashboard-panel">
        <label>Billing month<input className="ui-input" type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
        <label>Player search<input className="ui-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" /></label>
        <label>Subscription<select className="ui-select" value={subscriptionFilter} onChange={(event) => setSubscriptionFilter(event.target.value)}><option value="all">All</option><option value="active">Paid</option><option value="payment_due">Payment due</option><option value="grace_period">Grace period</option><option value="restricted">Restricted</option><option value="exempted">Exempted</option></select></label>
        <label>Payment method<select className="ui-select" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}><option value="all">All</option>{["cash", "mobile_money", "bank_deposit", "bank_transfer", "other"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label>
        <label>Payment status<select className="ui-select" value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)}><option value="all">All</option>{["pending_verification", "recorded", "verified", "reversed", "rejected"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label>
        {isSuperAdmin ? <label>Officer<select className="ui-select" value={officerFilter} onChange={(event) => setOfficerFilter(event.target.value)}><option value="all">All officers</option>{(dashboard.officers || []).map((officer) => <option key={officer.officer_id} value={officer.officer_id}>{officer.officer}</option>)}</select></label> : null}
        <span className="ui-badge ui-badge--neutral">{isSuperAdmin ? "Super Admin oversight" : "Private officer ledger"}</span>
      </section>

      {feedback.message ? (
        <div className={`ui-alert ui-alert--${feedback.type === "error" ? "danger" : "success"}`} role="status">
          <span>{feedback.message}</span>
          {feedback.type === "error" ? <button className="ui-button ui-button--secondary" type="button" onClick={load}>Retry</button> : null}
        </div>
      ) : null}

      {view === "record" ? (
        <RecordPaymentForm players={players} month={month} settings={settings} onSaved={handleSaved} onError={handleError} />
      ) : view === "remittances" ? (
        <RemittancePanel
          dashboard={dashboard}
          items={remittances}
          month={month}
          isSuperAdmin={isSuperAdmin}
          onSaved={handleSaved}
        />
      ) : (
        <>
          <FinancialSummary dashboard={dashboard} isSuperAdmin={isSuperAdmin} loading={loading} />
          <PaymentLedger payments={payments} players={players} isSuperAdmin={isSuperAdmin} onSaved={handleSaved} />
          {isPaymentOfficer ? (
            <RemittancePanel dashboard={dashboard} items={remittances} month={month} isSuperAdmin={false} onSaved={handleSaved} />
          ) : null}
          {isSuperAdmin ? (
            <>
              <ExemptionForm players={players} month={month} onSaved={handleSaved} />
              <BillingControls month={month} onSaved={handleSaved} />
              <RemittancePanel dashboard={dashboard} items={remittances} month={month} isSuperAdmin onSaved={handleSaved} />
            </>
          ) : null}
        </>
      )}
    </DashboardLayout>
  );

  async function handleSaved(message) {
    await load();
    setFeedback({ type: "success", message });
  }

  function handleError(message) {
    setFeedback({ type: "error", message: message || "The payment action could not be completed." });
  }
}

function FinancialSummary({ dashboard, isSuperAdmin, loading }) {
  const metrics = isSuperAdmin
    ? [
        ["Expected revenue", dashboard.expected_monthly_revenue],
        ["Collected", dashboard.total_collected],
        ["Verified remitted", dashboard.total_verified_remitted],
        ["Unremitted", dashboard.unremitted_balance],
        ["Restricted players", dashboard.restricted_players, false],
        ["Exemptions", dashboard.exemptions, false],
      ]
    : [
        ["Collected", dashboard.total_collected],
        ["Players paid", dashboard.players_paid, false],
        ["Unpaid players", dashboard.unpaid_players, false],
        ["Payments recorded", dashboard.payment_count, false],
        ["Pending submissions", dashboard.pending_submissions, false],
        ["Submitted", dashboard.total_submitted],
        ["Verified", dashboard.total_remitted],
        ["Outstanding", dashboard.outstanding_balance],
      ];
  return (
    <section className="financial-summary-grid" aria-busy={loading}>
      {metrics.map(([label, value, monetary = true]) => (
        <article className="admin-summary-card" key={label}><p className="panel-kicker">{label}</p><strong className="admin-summary-value">{monetary ? formatMoney(value) : value ?? 0}</strong></article>
      ))}
    </section>
  );
}

function RecordPaymentForm({ players, month, settings, onSaved, onError }) {
  const [form, setForm] = useState({ player_id: "", amount: "", payment_method: "mobile_money", reference: "", payment_date: new Date().toISOString().slice(0, 10), proof: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [proofPreview, setProofPreview] = useState("");
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  useEffect(() => {
    if (settings?.monthly_fee && !form.amount) {
      setForm((current) => ({ ...current, amount: Number(settings.monthly_fee).toFixed(2) }));
    }
  }, [settings?.monthly_fee]);

  useEffect(() => () => {
    if (proofPreview) URL.revokeObjectURL(proofPreview);
  }, [proofPreview]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await recordManualPayment({ ...form, billing_month: month });
      setForm((current) => ({ ...current, player_id: "", reference: "", proof: "", note: "" }));
      await onSaved(response.message || "Payment recorded and the subscription was recalculated.");
    } catch (error) {
      onError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadProof(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setProofPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const response = await uploadPaymentProof(file);
      setForm((current) => ({ ...current, proof: response.data?.proof || "" }));
    } catch (error) {
      onError(error.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="dashboard-panel financial-form" onSubmit={submit}>
      <div className="panel-header"><div><p className="panel-kicker">Authorized entry</p><h2 className="panel-title">Record a monthly payment</h2></div></div>
      <div className="financial-form-grid">
        <label>Player<select className="ui-select" name="player_id" value={form.player_id} onChange={update} required><option value="">Select player</option>{players.map((player) => <option key={player.id} value={player.id}>{player.username} · {formatStatus(player.subscription_status)}</option>)}</select></label>
        <label>Amount ({settings?.currency || "GHS"})<input className="ui-input" name="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={update} required /></label>
        <label>Method<select className="ui-select" name="payment_method" value={form.payment_method} onChange={update}>{["cash", "mobile_money", "bank_deposit", "bank_transfer", "other"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label>
        <label>Payment date<input className="ui-input" name="payment_date" type="date" value={form.payment_date} onChange={update} required /></label>
        <label>Receipt reference<input className="ui-input" name="reference" value={form.reference} onChange={update} maxLength="100" required={form.payment_method !== "cash"} /></label>
        <label>Proof attachment<input className="ui-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProof} />{uploading ? <small>Uploading securely…</small> : form.proof ? <small>Proof attached</small> : null}{proofPreview ? <img className="financial-proof-preview" src={proofPreview} alt="Selected payment proof preview" /> : null}</label>
      </div>
      <label>Optional note<textarea className="ui-textarea" name="note" value={form.note} onChange={update} maxLength="500" /></label>
      <button className="ui-button ui-button--primary" type="submit" disabled={saving}>{saving ? "Recording…" : "Review and record payment"}</button>
    </form>
  );
}

function PaymentLedger({ payments, players, isSuperAdmin, onSaved }) {
  const { user } = useAuth();
  const canReviewSubmission = user?.role === "payment_officer" || isSuperAdmin || user?.role === "admin";
  const names = useMemo(() => Object.fromEntries(players.map((player) => [player.id, player.username])), [players]);
  const [reasons, setReasons] = useState({});

  async function reverse(payment) {
    const reason = String(reasons[payment.id] || "").trim();
    if (!reason) return;
    await reverseManualPayment(payment.id, { reason });
    await onSaved("Payment reversed. The original record remains in the audit trail.");
  }

  async function verify(payment) {
    await verifyManualPayment(payment.id);
    await onSaved("Payment verified and the subscription was recalculated.");
  }
  async function reject(payment) {
    const reason = String(reasons[payment.id] || "").trim();
    if (!reason) return;
    await rejectPlayerPayment(payment.id, reason);
    await onSaved("Player payment submission rejected. The record was preserved.");
  }
  return (
    <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Authoritative records</p><h2 className="panel-title">Payment ledger</h2></div></div>
      <div className="financial-card-list">
        {payments.length ? payments.map((payment) => (
          <article className="financial-record-card" key={payment.id}>
            <div><strong>{names[payment.player_id] || "Player"}</strong><span>{formatMoney(payment.amount, payment.currency)} · {formatStatus(payment.payment_method)}</span></div>
            <span className={`ui-badge ui-badge--${payment.status === "reversed" ? "danger" : "success"}`}>{formatStatus(payment.status)}</span>
            <small>{payment.reference || "Cash"} · {formatDate(payment.payment_date)}</small>
            {canReviewSubmission && payment.source === "player_submission" && payment.status === "pending_verification" ? (
              <div className="financial-actions">
                <label>
                  Rejection reason
                  <input className="ui-input" value={reasons[payment.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [payment.id]: event.target.value }))} maxLength="500" />
                </label>
                <button className="ui-button ui-button--success" onClick={() => verify(payment)}>Verify submission</button>
                <button className="ui-button ui-button--danger" disabled={!String(reasons[payment.id] || "").trim()} onClick={() => reject(payment)}>Reject</button>
              </div>
            ) : null}
            {isSuperAdmin && ["recorded", "verified"].includes(payment.status) ? (
              <div className="financial-actions">
                {payment.status === "recorded" ? <button className="ui-button ui-button--success" onClick={() => verify(payment)}>Verify payment</button> : null}
                <label>
                  Reversal reason
                  <input className="ui-input" value={reasons[payment.id] || ""} onChange={(event) => setReasons((current) => ({ ...current, [payment.id]: event.target.value }))} maxLength="500" />
                </label>
                <button className="ui-button ui-button--danger" disabled={!String(reasons[payment.id] || "").trim()} onClick={() => reverse(payment)}>Reverse payment</button>
              </div>
            ) : null}
          </article>
        )) : <p className="empty-state-copy">No payment records for this period.</p>}
      </div>
    </section>
  );
}

function ExemptionForm({ players, month, onSaved }) {
  const [form, setForm] = useState({ player_id: "", reason: "", note: "" });
  async function submit(event) {
    event.preventDefault();
    await grantSubscriptionExemption({ ...form, billing_month: month });
    setForm({ player_id: "", reason: "", note: "" });
    await onSaved("Subscription exemption granted without creating a payment.");
  }
  return (
    <form className="dashboard-panel financial-form" onSubmit={submit}>
      <div className="panel-header"><div><p className="panel-kicker">Super Admin only</p><h2 className="panel-title">Grant exemption</h2></div></div>
      <div className="financial-form-grid">
        <label>Player<select className="ui-select" value={form.player_id} onChange={(event) => setForm((current) => ({ ...current, player_id: event.target.value }))} required><option value="">Select player</option>{players.map((player) => <option key={player.id} value={player.id}>{player.username}</option>)}</select></label>
        <label>Reason<input className="ui-input" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} maxLength="300" required /></label>
      </div>
      <label>Note<textarea className="ui-textarea" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} maxLength="500" /></label>
      <button className="ui-button ui-button--premium" type="submit">Grant exemption</button>
    </form>
  );
}

function BillingControls({ month, onSaved }) {
  const [summary, setSummary] = useState(null);
  async function execute(dryRun) {
    const response = await runMonthlyBilling({ billing_month: month, dry_run: dryRun });
    setSummary(response.data);
    await onSaved(dryRun ? "Billing preview completed without changes." : "Monthly billing completed safely.");
  }
  return (
    <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Idempotent process</p><h2 className="panel-title">Monthly billing</h2></div></div>
      <div className="financial-actions">
        <button className="ui-button ui-button--secondary" onClick={() => execute(true)}>Preview dry run</button>
        <button className="ui-button ui-button--primary" onClick={() => execute(false)}>Run billing for {month}</button>
      </div>
      {summary ? <p className="section-copy">{summary.players_inspected} players inspected · {summary.subscriptions_created} subscriptions created · {summary.accounts_restricted} restricted</p> : null}
    </section>
  );
}

function RemittancePanel({ dashboard, items, month, isSuperAdmin, onSaved }) {
  const [form, setForm] = useState({ amount: "", method: "mobile_money", destination: "", reference: "", remittance_date: new Date().toISOString().slice(0, 10), proof: "", note: "" });
  const [reviewReasons, setReviewReasons] = useState({});
  const [proofPreview, setProofPreview] = useState("");
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  useEffect(() => () => {
    if (proofPreview) URL.revokeObjectURL(proofPreview);
  }, [proofPreview]);

  async function uploadProof(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setProofPreview(URL.createObjectURL(file));
    const response = await uploadPaymentProof(file);
    setForm((current) => ({ ...current, proof: response.data?.proof || "" }));
  }

  async function submit(event) {
    event.preventDefault();
    await submitRemittance({ ...form, billing_month: month });
    await onSaved("Remittance submitted for Super Admin verification.");
  }

  async function review(item, action) {
    const reason = action === "verify" ? "" : String(reviewReasons[item.id] || "").trim();
    if (action !== "verify" && !reason) return;
    await reviewRemittance(item.id, { action, reason });
    await onSaved(`Remittance ${action === "verify" ? "verified" : action === "reverse" ? "reversed" : "rejected"}.`);
  }

  return (
    <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Reconciliation</p><h2 className="panel-title">{isSuperAdmin ? "Remittance review" : "Remit collections"}</h2></div></div>
      {!isSuperAdmin ? (
        <form className="financial-form-grid" onSubmit={submit}>
          <label>Amount available: {formatMoney(dashboard.available_to_remit)}<input className="ui-input" name="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={update} required /></label>
          <label>Method<select className="ui-select" name="method" value={form.method} onChange={update}>{["mobile_money", "bank_deposit", "bank_transfer"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}</select></label>
          <label>Destination<input className="ui-input" name="destination" value={form.destination} onChange={update} required /></label>
          <label>Reference<input className="ui-input" name="reference" value={form.reference} onChange={update} required /></label>
          <label>Date<input className="ui-input" name="remittance_date" type="date" value={form.remittance_date} onChange={update} required /></label>
          <label>Proof attachment<input className="ui-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadProof} />{form.proof ? <small>Proof attached</small> : null}{proofPreview ? <img className="financial-proof-preview" src={proofPreview} alt="Selected remittance proof preview" /> : null}</label>
          <button className="ui-button ui-button--primary" type="submit">Submit for verification</button>
        </form>
      ) : null}
      <div className="financial-card-list">
        {items.length ? items.map((item) => (
          <article className="financial-record-card" key={item.id}>
            <div>
              <strong>{formatMoney(item.amount, item.currency)}</strong>
              <span>{item.officer?.name ? `${item.officer.name} · ` : ""}{formatStatus(item.method)} · {item.destination}</span>
              {item.officer_ledger ? <small>Collected {formatMoney(item.officer_ledger.total_collected)} · previously remitted {formatMoney(item.officer_ledger.total_remitted)} · current balance {formatMoney(item.officer_ledger.outstanding_balance)}</small> : null}
            </div>
            <span className={`ui-badge ui-badge--${item.status === "verified" ? "success" : item.status === "rejected" ? "danger" : "warning"}`}>{formatStatus(item.status)}</span>
            <small>{item.reference} · {formatDate(item.submitted_at)}</small>
            {isSuperAdmin && item.status === "pending_verification" ? (
              <div className="financial-actions">
                <label>
                  Rejection reason
                  <input
                    className="ui-input"
                    value={reviewReasons[item.id] || ""}
                    onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Required only when rejecting"
                    maxLength="500"
                  />
                </label>
                <button className="ui-button ui-button--success" onClick={() => review(item, "verify")}>Verify</button>
                <button className="ui-button ui-button--danger" disabled={!String(reviewReasons[item.id] || "").trim()} onClick={() => review(item, "reject")}>Reject</button>
              </div>
            ) : null}
            {isSuperAdmin && item.status === "verified" ? (
              <div className="financial-actions">
                <label>
                  Reversal reason
                  <input
                    className="ui-input"
                    value={reviewReasons[item.id] || ""}
                    onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                    maxLength="500"
                  />
                </label>
                <button className="ui-button ui-button--danger" disabled={!String(reviewReasons[item.id] || "").trim()} onClick={() => review(item, "reverse")}>Reverse verified remittance</button>
              </div>
            ) : null}
          </article>
        )) : <p className="empty-state-copy">No remittances found.</p>}
      </div>
    </section>
  );
}

function formatMoney(value, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: currency || "GHS" }).format(Number(value || 0));
}
function formatStatus(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value)) : "—"; }
