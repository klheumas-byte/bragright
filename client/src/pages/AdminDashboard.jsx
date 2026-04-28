import { useEffect, useState } from "react";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getAdminSummary } from "../services/api";

const initialSummary = {
  total_users: 0,
  active_players: 0,
  disabled_accounts: 0,
  open_disputes: 0,
  pending_confirmations: 0,
  match_requests: 0,
  total_admins: 0,
  recent_activity: [],
};

export default function AdminDashboard() {
  const { trackLoading } = useLoading();
  const [summary, setSummary] = useState(initialSummary);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    loadSummary();
  }, []);

  async function loadSummary() {
    try {
      setIsLoading(true);
      setFeedback({ type: "", message: "" });
      const response = await trackLoading(() => getAdminSummary());
      setSummary(response.data || initialSummary);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  const cards = [
    {
      id: "users",
      label: "Total Users",
      value: summary.total_users,
      copy: "All player and admin accounts currently managed in BragRight.",
    },
    {
      id: "players",
      label: "Active Players",
      value: summary.active_players,
      copy: "Player accounts that can currently sign in and use the competitive flow.",
    },
    {
      id: "disabled",
      label: "Disabled Accounts",
      value: summary.disabled_accounts,
      copy: "Accounts that are currently blocked from sign-in until an admin re-enables them.",
    },
    {
      id: "disputes",
      label: "Open Disputes",
      value: summary.open_disputes,
      copy: "Disputed results currently waiting for final admin moderation.",
    },
    {
      id: "confirmations",
      label: "Pending Confirmations",
      value: summary.pending_confirmations,
      copy: "Submitted results waiting on the opponent before they become trusted records.",
    },
    {
      id: "requests",
      label: "Match Requests",
      value: summary.match_requests,
      copy: "Scheduled requests that still need the opponent to accept or decline.",
    },
  ];

  return (
    <DashboardLayout
      title="Admin Dashboard"
      description=""
    >
      <section className="feature-hero-card admin-hero-card">
        <div>
          <p className="section-label">Admin</p>
          <h2 className="feature-hero-title">System overview.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Admin accounts</p>
          <p className="feature-callout-value">{summary.total_admins}</p>
        </div>
      </section>

      <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={loadSummary} />

      {isLoading ? (
        <SectionLoader lines={6} message="Loading admin dashboard..." />
      ) : (
        <>
          <section className="admin-summary-grid">
            {cards.map((card) => (
              <article key={card.id} className="admin-summary-card">
                <p className="panel-kicker">{card.label}</p>
                <strong className="admin-summary-value">{card.value}</strong>
                <p className="panel-subtitle">{card.copy}</p>
              </article>
            ))}
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Recent Activity</p>
                <h2 className="panel-title">Latest platform events</h2>
              </div>
            </div>

            {summary.recent_activity.length ? (
              <div className="admin-activity-list">
                {summary.recent_activity.map((activity) => (
                  <article key={activity.id} className="admin-activity-card">
                    <p className="admin-dispute-list-title">{activity.action_label}</p>
                    <p className="match-card-meta">{activity.summary || "Recorded system activity."}</p>
                    <p className="match-card-meta">{formatDate(activity.created_at)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">No recent platform activity has been recorded yet.</p>
              </div>
            )}
          </section>
        </>
      )}
    </DashboardLayout>
  );
}

function formatDate(value) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
