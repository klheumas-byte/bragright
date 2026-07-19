import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ErrorState from "../components/ErrorState";
import ProfileAvatar from "../components/ProfileAvatar";
import SectionLoader from "../components/SectionLoader";
import { useAuth } from "../context/AuthContext";
import { getAdminProfile } from "../services/api";
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
      setProfile(normalizeAdminProfile(response?.data, user));
    } catch (error) {
      setErrorMessage(error.message);
      setProfile(normalizeAdminProfile(null, user));
    } finally {
      setIsLoading(false);
    }
  }

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
      description="Your operator identity and recent arena actions."
    >
      <ErrorState message={errorMessage} onRetry={loadAdminProfile} />

      {isLoading ? (
        <SectionLoader lines={8} message="Loading admin profile..." />
      ) : (
        <>
          <section className="profile-hero-card">
            <div className="profile-hero-layout">
              <div className="profile-identity-block">
                <ProfileAvatar
                  image={profile.profile_image}
                  name={profile.username || user?.username || "Admin"}
                  size="xl"
                  className="profile-avatar-large"
                  loading="eager"
                />

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
              <ActivityList activities={profile.recent_admin_activity} admin compact label="Your latest admin actions" />
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

function normalizeAdminProfile(profile, fallbackUser) {
  return {
    ...emptyProfile,
    ...(profile || {}),
    username: profile?.username || fallbackUser?.username || "",
    email: profile?.email || fallbackUser?.email || "",
    role: profile?.role || fallbackUser?.role || "admin",
    status: profile?.status || fallbackUser?.status || "active",
    profile_image: profile?.profile_image || fallbackUser?.profile_image || "",
    quick_links: Array.isArray(profile?.quick_links) ? profile.quick_links : [],
    recent_admin_activity: Array.isArray(profile?.recent_admin_activity)
      ? profile.recent_admin_activity
      : [],
    access_summary: {
      managed_users: profile?.access_summary?.managed_users ?? 0,
      active_players: profile?.access_summary?.active_players ?? 0,
      disabled_accounts: profile?.access_summary?.disabled_accounts ?? 0,
      open_disputes: profile?.access_summary?.open_disputes ?? 0,
      pending_confirmations: profile?.access_summary?.pending_confirmations ?? 0,
      match_requests: profile?.access_summary?.match_requests ?? 0,
    },
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
