import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ErrorState from "../components/ErrorState";
import ProfileAvatar from "../components/ProfileAvatar";
import SectionLoader from "../components/SectionLoader";
import { Badge, Card, EmptyState, PageSection } from "../components/ui";
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
          <Card as="section" variant="dashboard" className="profile-hero-card">
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
                    <Badge tone="info">Admin</Badge>
                    <Badge tone={profile.status === "active" ? "success" : "danger"}>
                      {profile.status || "active"}
                    </Badge>
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
          </Card>

          <PageSection title="Quick Links" description="Admin tools.">
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
          </PageSection>

          <PageSection title="Access summary" description="Your current administrative scope.">
            <section className="admin-summary-grid">
              {accessCards.map((card) => (
                <Card as="article" variant="dashboard" className="admin-summary-card" key={card.label}>
                  <p className="panel-kicker">{card.label}</p>
                  <strong className="admin-summary-value">{card.value}</strong>
                </Card>
              ))}
            </section>
          </PageSection>

          <PageSection title="Recent Admin Activity" description="Your latest actions.">
            {profile.recent_admin_activity.length ? (
              <ActivityList activities={profile.recent_admin_activity} admin compact label="Your latest admin actions" />
            ) : (
              <Card variant="empty">
                <EmptyState title="No admin activity" description="No admin activity has been recorded yet." />
              </Card>
            )}
          </PageSection>
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
