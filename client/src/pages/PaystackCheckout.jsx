import { useEffect, useState } from "react";
import PayAheadPanel from "../components/PayAheadPanel";
import DashboardLayout from "../layouts/DashboardLayout";
import { getSubscriptionStatus } from "../services/api";

export default function PaystackCheckout() {
  const [state, setState] = useState({ loading: true, error: "", data: null });

  useEffect(() => {
    getSubscriptionStatus()
      .then((response) => setState({ loading: false, error: "", data: response.data }))
      .catch((error) => setState({ loading: false, error: error.message, data: null }));
  }, []);

  return (
    <DashboardLayout title="Pay Ahead" description="Secure hosted Mobile Money checkout powered by Paystack.">
      {state.loading ? <div className="dashboard-panel skeleton" role="status">Loading Pay Ahead options…</div> : null}
      {state.error ? <div className="ui-alert ui-alert--danger" role="alert">{state.error}</div> : null}
      {!state.loading && !state.error ? <PayAheadPanel options={state.data?.pay_ahead_options} /> : null}
    </DashboardLayout>
  );
}
