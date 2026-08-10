import { useEffect, useRef, useState } from "react";
import Button from "./ui/Button";
import { initializePaystackPayment } from "../services/api";

export default function PayAheadPanel({ options = [], disabled = false }) {
  const [months, setMonths] = useState(1);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");
  const initializationInFlight = useRef(false);
  const selected = options.find((option) => option.months === months) || options[0];
  const currency = selected?.currency || "GHS";

  useEffect(() => {
    if (options.length && !options.some((option) => option.months === months)) {
      setMonths(options[0].months);
    }
  }, [months, options]);

  async function payWithMobileMoney() {
    if (!selected || disabled || initializationInFlight.current) return;
    initializationInFlight.current = true;
    setPaying(true);
    setError("");
    try {
      const response = await initializePaystackPayment(selected.months);
      const authorizationUrl = response.data?.authorization_url;
      if (!authorizationUrl) throw new Error("Paystack checkout could not be started.");
      window.location.assign(authorizationUrl);
    } catch (requestError) {
      setError(requestError.message);
      setPaying(false);
      initializationInFlight.current = false;
    }
  }

  return (
    <section className="dashboard-panel payment-checkout-card" aria-busy={paying}>
      <div className="panel-header">
        <div><p className="panel-kicker">PAY AHEAD</p><h2 className="panel-title">Prepay your BragRight subscription</h2></div>
      </div>
      {options.length ? (
        <>
          <dl className="financial-detail-grid">
            <div><dt>Monthly rate</dt><dd>{formatMoney(selected?.monthly_rate, currency)}</dd></div>
            <div><dt>Months selected</dt><dd>{selected?.months}</dd></div>
            <div><dt>Coverage</dt><dd>{formatCoverage(selected)}</dd></div>
            <div><dt>Total</dt><dd>{formatMoney(selected?.total, currency)}</dd></div>
            <div><dt>Payment method</dt><dd>Mobile Money</dd></div>
          </dl>
          <div className="financial-card-list" role="group" aria-label="Pay Ahead months">
            {options.map((option) => (
              <Button
                key={option.months}
                type="button"
                variant={option.months === selected?.months ? "primary" : "secondary"}
                aria-pressed={option.months === selected?.months}
                onClick={() => setMonths(option.months)}
              >
                {option.months} {option.months === 1 ? "Month" : "Months"} — {formatMoney(option.total, option.currency)}
              </Button>
            ))}
          </div>
          <p className="section-copy">BragRight calculates the total and coverage. Paystack securely handles your Mobile Money authorization.</p>
          {disabled ? <div className="ui-alert ui-alert--warning">A submitted payment is already awaiting verification.</div> : null}
          {error ? <div className="ui-alert ui-alert--danger" role="alert"><strong>Payment Failed</strong><p>{error}</p></div> : null}
          <Button type="button" onClick={payWithMobileMoney} disabled={disabled || paying}>
            {paying ? "Opening secure checkout…" : `Pay ${formatMoney(selected?.total, currency)} with MoMo`}
          </Button>
        </>
      ) : (
        <div className="ui-alert ui-alert--danger" role="alert">Pay Ahead options could not be loaded. Please retry this page.</div>
      )}
    </section>
  );
}

function formatMoney(value, currency = "GHS") {
  return new Intl.NumberFormat("en-GH", { style: "currency", currency }).format(Number(value || 0));
}

function formatCoverage(option) {
  const first = formatPeriod(option?.first_covered_period);
  const last = formatPeriod(option?.last_covered_period);
  return first === last ? first : `${first} – ${last}`;
}

function formatPeriod(value) {
  const [year, month] = String(value || "").split("-").map(Number);
  if (!year || !month) return "Unavailable";
  return new Intl.DateTimeFormat("en-GH", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}
