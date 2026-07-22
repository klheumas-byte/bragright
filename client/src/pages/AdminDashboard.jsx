import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SidebarIcon from "../components/SidebarIcon";
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

const adminActions = [
  { to: "/admin/users", icon: "users", label: "Manage users", copy: "Create accounts, update access, and reset passwords." },
  { to: "/admin/disputes", icon: "disputes", label: "Review disputes", copy: "Resolve contested matches and protect trusted results." },
  { to: "/admin/activity", icon: "activity", label: "View activity", copy: "Review recent administrative and platform events." },
  { to: "/admin/settings", icon: "settings", label: "Open settings", copy: "Adjust system rules and appearance preferences." },
];

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
      setSummary(normalizeAdminSummary(response?.data));
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
      setSummary(initialSummary);
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
      description="Keep BragRight's competitive arena trusted and operational."
      showBackButton={false}
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

      <section className="dashboard-panel admin-action-panel" aria-labelledby="admin-quick-actions-title">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Quick actions</p>
            <h2 className="panel-title" id="admin-quick-actions-title">What would you like to manage?</h2>
          </div>
        </div>
        <div className="admin-quick-actions">
          {adminActions.map((action) => (
            <Link className="admin-quick-action" to={action.to} key={action.to}>
              <span className="admin-quick-action-icon" aria-hidden="true">
                <SidebarIcon name={action.icon} decorative />
              </span>
              <span className="admin-quick-action-copy">
                <strong>{action.label}</strong>
                <small>{action.copy}</small>
              </span>
              <span className="admin-quick-action-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      </section>

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
              <ActivityList activities={summary.recent_activity} admin compact label="Latest platform events" />
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

function normalizeAdminSummary(summary) {
  return {
    total_users: summary?.total_users ?? 0,
    active_players: summary?.active_players ?? 0,
    disabled_accounts: summary?.disabled_accounts ?? 0,
    open_disputes: summary?.open_disputes ?? 0,
    pending_confirmations: summary?.pending_confirmations ?? 0,
    match_requests: summary?.match_requests ?? 0,
    total_admins: summary?.total_admins ?? 0,
    recent_activity: Array.isArray(summary?.recent_activity) ? summary.recent_activity : [],
  };
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
