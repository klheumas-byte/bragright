import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import { useAuth } from "../context/AuthContext";
import { getApiAssetUrl, getAdminProfile } from "../services/api";
import DashboardLayout from "../layouts/DashboardLayout";

const emptyProfile = {
  username: "",
  email: "",
  role: "admin",
  status: "active",
  created_at: null,
  last_login: null,
  profile_image: "",
  quick_links: [],
  recent_admin_activity: [],
  access_summary: {
    managed_users: 0,
    active_players: 0,
    disabled_accounts: 0,
    open_disputes: 0,
    pending_confirmations: 0,
    match_requests: 0,
  },
};

export default function AdminProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(emptyProfile);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    loadAdminProfile();
  }, []);

  async function loadAdminProfile() {
    try {
      setIsLoading(true);
      setErrorMessage("");
      const response = await getAdminProfile();
      setProfile({
        ...emptyProfile,
        ...(response?.data || {}),
      });
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  const avatarImage = getApiAssetUrl(profile.profile_image);
  const accessCards = [
    { label: "Managed Users", value: profile.access_summary.managed_users },
    { label: "Active Players", value: profile.access_summary.active_players },
    { label: "Disabled Accounts", value: profile.access_summary.disabled_accounts },
    { label: "Open Disputes", value: profile.access_summary.open_disputes },
    { label: "Pending Confirmations", value: profile.access_summary.pending_confirmations },
    { label: "Match Requests", value: profile.access_summary.match_requests },
  ];

  return (
    <DashboardLayout
      title="Admin Profile"
      description=""
    >
      <ErrorState message={errorMessage} onRetry={loadAdminProfile} />

      {isLoading ? (
        <SectionLoader lines={8} message="Loading admin profile..." />
      ) : (
        <>
          <section className="profile-hero-card">
            <div className="profile-hero-layout">
              <div className="profile-identity-block">
                <div className="profile-avatar profile-avatar-large">
                  {avatarImage ? (
                    <img src={avatarImage} alt={`${profile.username || "Admin"} profile`} className="profile-avatar-image" />
                  ) : (
                    getInitials(profile.username || profile.email || user?.email || "AD")
                  )}
                </div>

                <div className="profile-identity-copy">
                  <h2 className="profile-hero-title">{profile.username || user?.username || "Admin"}</h2>
                  <p className="profile-hero-email">{profile.email || user?.email || "—"}</p>
                  <div className="profile-match-badges">
                    <span className="match-status-badge match-status-pending">Admin</span>
                    <span className={`match-status-badge ${profile.status === "active" ? "match-status-confirmed" : "match-status-rejected"}`}>
                      {profile.status || "active"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="profile-meta-grid">
                <div className="profile-meta-card">
                  <span className="match-score-label">Date joined</span>
                  <strong>{formatDate(profile.created_at)}</strong>
                </div>
                <div className="profile-meta-card">
                  <span className="match-score-label">Last login</span>
                  <strong>{formatDate(profile.last_login || profile.last_login_at)}</strong>
                </div>
                <div className="profile-meta-card">
                  <span className="match-score-label">Role</span>
                  <strong>{profile.role || "admin"}</strong>
                </div>
              </div>
            </div>
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Quick Links</p>
                <h2 className="panel-title">Admin tools</h2>
              </div>
            </div>

            <div className="action-card-grid">
              {profile.quick_links.map((link) => (
                <Link key={link.to} className="action-card action-card-clickable action-card-neutral" to={link.to}>
                  <div className="action-card-top">
                    <p className="action-card-eyebrow">{link.label}</p>
                  </div>
                  <span className="action-card-link">Open</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="admin-summary-grid">
            {accessCards.map((card) => (
              <article key={card.label} className="admin-summary-card">
                <p className="panel-kicker">{card.label}</p>
                <strong className="admin-summary-value">{card.value}</strong>
              </article>
            ))}
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Recent Admin Activity</p>
                <h2 className="panel-title">Your latest actions</h2>
              </div>
            </div>

            {profile.recent_admin_activity.length ? (
              <div className="admin-activity-list">
                {profile.recent_admin_activity.map((activity) => (
                  <article key={activity.id} className="admin-activity-card">
                    <p className="admin-dispute-list-title">{activity.action_label}</p>
                    <p className="match-card-meta">{activity.summary || "Recorded admin activity."}</p>
                    <p className="match-card-meta">{formatDate(activity.created_at)}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">No admin activity has been recorded yet.</p>
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

function getInitials(value) {
  return String(value || "")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
