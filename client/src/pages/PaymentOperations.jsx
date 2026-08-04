import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  PageSection,
  Select,
  Textarea,
} from "../components/ui";
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
      <PageSection
        title="Filters"
        description="Scope collections and records to a billing month, player, or method."
        actions={<Badge tone="neutral">{isSuperAdmin ? "Super Admin oversight" : "Private officer ledger"}</Badge>}
      >
        <Card variant="dashboard" className="financial-toolbar">
          <Field type="month" label="Billing month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <Field type="search" label="Player search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or email" />
          <Field control={Select} label="Subscription" value={subscriptionFilter} onChange={(event) => setSubscriptionFilter(event.target.value)}>
            <option value="all">All</option>
            <option value="active">Paid</option>
            <option value="payment_due">Payment due</option>
            <option value="grace_period">Grace period</option>
            <option value="restricted">Restricted</option>
            <option value="exempted">Exempted</option>
          </Field>
          <Field control={Select} label="Payment method" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
            <option value="all">All</option>
            {["cash", "mobile_money", "bank_deposit", "bank_transfer", "other"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}
          </Field>
          <Field control={Select} label="Payment status" value={paymentStatusFilter} onChange={(event) => setPaymentStatusFilter(event.target.value)}>
            <option value="all">All</option>
            {["pending_verification", "recorded", "verified", "reversed", "rejected"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}
          </Field>
          {isSuperAdmin ? (
            <Field control={Select} label="Officer" value={officerFilter} onChange={(event) => setOfficerFilter(event.target.value)}>
              <option value="all">All officers</option>
              {(dashboard.officers || []).map((officer) => <option key={officer.officer_id} value={officer.officer_id}>{officer.officer}</option>)}
            </Field>
          ) : null}
        </Card>
      </PageSection>

      {feedback.message ? (
        <Alert
          tone={feedback.type === "error" ? "error" : "success"}
          action={feedback.type === "error" ? <Button variant="secondary" size="sm" onClick={load}>Retry</Button> : null}
        >
          {feedback.message}
        </Alert>
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
    <PageSection title="Financial summary" description="Authoritative totals for the selected billing month.">
      <section className="financial-summary-grid" aria-busy={loading}>
        {metrics.map(([label, value, monetary = true]) => (
          <Card as="article" variant="dashboard" className="admin-summary-card" key={label}>
            <p className="panel-kicker">{label}</p>
            <strong className="admin-summary-value">{monetary ? formatMoney(value) : value ?? 0}</strong>
          </Card>
        ))}
      </section>
    </PageSection>
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
    <PageSection title="Record a monthly payment" description="Authorized entry.">
      <Card as="form" variant="dashboard" className="financial-form" onSubmit={submit}>
        <div className="financial-form-grid">
          <Field control={Select} label="Player" name="player_id" value={form.player_id} onChange={update} required>
            <option value="">Select player</option>
            {players.map((player) => <option key={player.id} value={player.id}>{player.username} · {formatStatus(player.subscription_status)}</option>)}
          </Field>
          <Field label={`Amount (${settings?.currency || "GHS"})`} name="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={update} required />
          <Field control={Select} label="Method" name="payment_method" value={form.payment_method} onChange={update}>
            {["cash", "mobile_money", "bank_deposit", "bank_transfer", "other"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}
          </Field>
          <Field label="Payment date" name="payment_date" type="date" value={form.payment_date} onChange={update} required />
          <Field label="Receipt reference" name="reference" value={form.reference} onChange={update} maxLength="100" required={form.payment_method !== "cash"} />
          <Field
            label="Proof attachment"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={uploadProof}
            description={uploading ? "Uploading securely…" : form.proof ? "Proof attached" : undefined}
          />
          {proofPreview ? <img className="financial-proof-preview" src={proofPreview} alt="Selected payment proof preview" /> : null}
        </div>
        <Field control={Textarea} label="Optional note" name="note" value={form.note} onChange={update} maxLength="500" />
        <Button type="submit" isLoading={saving} loadingText="Recording…">Review and record payment</Button>
      </Card>
    </PageSection>
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
    <PageSection title="Payment ledger" description="Authoritative records.">
      {payments.length ? (
        <div className="financial-card-list">
          {payments.map((payment) => (
            <Card as="article" variant="dashboard" className="financial-record-card" key={payment.id}>
              <div><strong>{names[payment.player_id] || "Player"}</strong><span>{formatMoney(payment.amount, payment.currency)} · {formatStatus(payment.payment_method)}</span></div>
              <Badge tone={payment.status === "reversed" ? "danger" : "success"}>{formatStatus(payment.status)}</Badge>
              <small>{payment.reference || "Cash"} · {formatDate(payment.payment_date)}</small>
              {canReviewSubmission && payment.source === "player_submission" && payment.status === "pending_verification" ? (
                <div className="financial-actions">
                  <Field
                    label="Rejection reason"
                    value={reasons[payment.id] || ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [payment.id]: event.target.value }))}
                    maxLength="500"
                  />
                  <Button variant="success" size="sm" onClick={() => verify(payment)}>Verify submission</Button>
                  <Button variant="danger" size="sm" disabled={!String(reasons[payment.id] || "").trim()} onClick={() => reject(payment)}>Reject</Button>
                </div>
              ) : null}
              {isSuperAdmin && ["recorded", "verified"].includes(payment.status) ? (
                <div className="financial-actions">
                  {payment.status === "recorded" ? <Button variant="success" size="sm" onClick={() => verify(payment)}>Verify payment</Button> : null}
                  <Field
                    label="Reversal reason"
                    value={reasons[payment.id] || ""}
                    onChange={(event) => setReasons((current) => ({ ...current, [payment.id]: event.target.value }))}
                    maxLength="500"
                  />
                  <Button variant="danger" size="sm" disabled={!String(reasons[payment.id] || "").trim()} onClick={() => reverse(payment)}>Reverse payment</Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="empty">
          <EmptyState title="No payment records" description="No payment records for this period." />
        </Card>
      )}
    </PageSection>
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
    <PageSection title="Grant exemption" description="Super Admin only.">
      <Card as="form" variant="dashboard" className="financial-form" onSubmit={submit}>
        <div className="financial-form-grid">
          <Field control={Select} label="Player" value={form.player_id} onChange={(event) => setForm((current) => ({ ...current, player_id: event.target.value }))} required>
            <option value="">Select player</option>
            {players.map((player) => <option key={player.id} value={player.id}>{player.username}</option>)}
          </Field>
          <Field label="Reason" value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} maxLength="300" required />
        </div>
        <Field control={Textarea} label="Note" value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} maxLength="500" />
        <Button type="submit" variant="premium">Grant exemption</Button>
      </Card>
    </PageSection>
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
    <PageSection title="Monthly billing" description="Idempotent process.">
      <Card variant="dashboard">
        <div className="financial-actions">
          <Button variant="secondary" onClick={() => execute(true)}>Preview dry run</Button>
          <Button variant="primary" onClick={() => execute(false)}>Run billing for {month}</Button>
        </div>
        {summary ? <p className="section-copy">{summary.players_inspected} players inspected · {summary.subscriptions_created} subscriptions created · {summary.accounts_restricted} restricted</p> : null}
      </Card>
    </PageSection>
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
    <PageSection title={isSuperAdmin ? "Remittance review" : "Remit collections"} description="Reconciliation.">
      {!isSuperAdmin ? (
        <Card as="form" variant="dashboard" className="financial-form-grid" onSubmit={submit}>
          <Field label={`Amount available: ${formatMoney(dashboard.available_to_remit)}`} name="amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={update} required />
          <Field control={Select} label="Method" name="method" value={form.method} onChange={update}>
            {["mobile_money", "bank_deposit", "bank_transfer"].map((value) => <option key={value} value={value}>{formatStatus(value)}</option>)}
          </Field>
          <Field label="Destination" name="destination" value={form.destination} onChange={update} required />
          <Field label="Reference" name="reference" value={form.reference} onChange={update} required />
          <Field label="Date" name="remittance_date" type="date" value={form.remittance_date} onChange={update} required />
          <Field
            label="Proof attachment"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={uploadProof}
            description={form.proof ? "Proof attached" : undefined}
          />
          {proofPreview ? <img className="financial-proof-preview" src={proofPreview} alt="Selected remittance proof preview" /> : null}
          <Button type="submit">Submit for verification</Button>
        </Card>
      ) : null}
      {items.length ? (
        <div className="financial-card-list">
          {items.map((item) => (
            <Card as="article" variant="dashboard" className="financial-record-card" key={item.id}>
              <div>
                <strong>{formatMoney(item.amount, item.currency)}</strong>
                <span>{item.officer?.name ? `${item.officer.name} · ` : ""}{formatStatus(item.method)} · {item.destination}</span>
                {item.officer_ledger ? <small>Collected {formatMoney(item.officer_ledger.total_collected)} · previously remitted {formatMoney(item.officer_ledger.total_remitted)} · current balance {formatMoney(item.officer_ledger.outstanding_balance)}</small> : null}
              </div>
              <Badge tone={item.status === "verified" ? "success" : item.status === "rejected" ? "danger" : "warning"}>{formatStatus(item.status)}</Badge>
              <small>{item.reference} · {formatDate(item.submitted_at)}</small>
              {isSuperAdmin && item.status === "pending_verification" ? (
                <div className="financial-actions">
                  <Field
                    label="Rejection reason"
                    value={reviewReasons[item.id] || ""}
                    onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="Required only when rejecting"
                    maxLength="500"
                  />
                  <Button variant="success" size="sm" onClick={() => review(item, "verify")}>Verify</Button>
                  <Button variant="danger" size="sm" disabled={!String(reviewReasons[item.id] || "").trim()} onClick={() => review(item, "reject")}>Reject</Button>
                </div>
              ) : null}
              {isSuperAdmin && item.status === "verified" ? (
                <div className="financial-actions">
                  <Field
                    label="Reversal reason"
                    value={reviewReasons[item.id] || ""}
                    onChange={(event) => setReviewReasons((current) => ({ ...current, [item.id]: event.target.value }))}
                    maxLength="500"
                  />
                  <Button variant="danger" size="sm" disabled={!String(reviewReasons[item.id] || "").trim()} onClick={() => review(item, "reverse")}>Reverse verified remittance</Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      ) : (
        <Card variant="empty">
          <EmptyState title="No remittances" description="No remittances found." />
        </Card>
      )}
    </PageSection>
  );
}

function formatMoney(value, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency: currency || "GHS" }).format(Number(value || 0));
}
function formatStatus(value) { return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatDate(value) { return value ? new Intl.DateTimeFormat("en-GH", { dateStyle: "medium" }).format(new Date(value)) : "—"; }
