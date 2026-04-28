import { useEffect, useState } from "react";
import ButtonLoadingText from "../components/ButtonLoadingText";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getAdminActivity } from "../services/api";

const initialFilters = {
  user: "",
  role: "",
  action_type: "",
  start_date: "",
  end_date: "",
};

export default function AdminActivity() {
  const { trackLoading } = useLoading();
  const [filters, setFilters] = useState(initialFilters);
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    loadActivityLogs(initialFilters, true);
  }, []);

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setFilters((currentFilters) => ({
      ...currentFilters,
      [name]: value,
    }));
  }

  async function loadActivityLogs(nextFilters = filters, isInitialLoad = false) {
    try {
      if (isInitialLoad) {
        setIsLoading(true);
      } else {
        setIsFiltering(true);
      }
      setFeedback({ type: "", message: "" });
      const response = await trackLoading(() => getAdminActivity(nextFilters));
      setLogs(response.data.logs || []);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
      setIsFiltering(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await loadActivityLogs(filters);
  }

  return (
    <DashboardLayout
      title="Admin Activity"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Activity</p>
          <h2 className="feature-hero-title">System activity logs.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Visible events</p>
          <p className="feature-callout-value">{logs.length}</p>
        </div>
      </section>

      <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={() => loadActivityLogs(filters, isLoading)} />

      <section className="dashboard-panel">
        <form className="admin-activity-filters" onSubmit={handleSubmit}>
          <label className="form-field">
            User ID
            <input name="user" value={filters.user} onChange={handleFilterChange} placeholder="Filter by user id" />
          </label>

          <label className="form-field">
            Role
            <select name="role" value={filters.role} onChange={handleFilterChange}>
              <option value="">All roles</option>
              <option value="player">Player</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <label className="form-field">
            Action type
            <input
              name="action_type"
              value={filters.action_type}
              onChange={handleFilterChange}
              placeholder="login, match_submitted, admin_role_changed..."
            />
          </label>

          <label className="form-field">
            Start date
            <input type="date" name="start_date" value={filters.start_date} onChange={handleFilterChange} />
          </label>

          <label className="form-field">
            End date
            <input type="date" name="end_date" value={filters.end_date} onChange={handleFilterChange} />
          </label>

          <button className="auth-button" type="submit" disabled={isFiltering}>
            <ButtonLoadingText isLoading={isFiltering} loadingText="Filtering...">
              Apply Filters
            </ButtonLoadingText>
          </button>
        </form>
      </section>

      {isLoading ? (
        <SectionLoader lines={8} message="Loading admin activity..." />
      ) : logs.length ? (
        <section className="admin-activity-list">
          {logs.map((log) => (
            <article key={log.id} className="admin-activity-card">
              <div className="admin-user-card-top">
                <div>
                  <p className="admin-dispute-list-title">{log.action_label}</p>
                  <p className="match-card-meta">{log.action_type}</p>
                </div>
                <span className="match-status-badge match-status-pending">{log.role || "unknown"}</span>
              </div>

              <div className="admin-user-meta-grid">
                <div className="match-score-line">
                  <span className="match-score-label">User</span>
                  <strong>{log.username || "Unknown user"}</strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">When</span>
                  <strong>{formatDate(log.created_at)}</strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">IP</span>
                  <strong>{log.ip_address || "Not available"}</strong>
                </div>
              </div>

              <div className="match-dispute-note-panel">
                <p className="match-score-label">Details</p>
                <pre className="admin-log-details">{JSON.stringify(log.details || {}, null, 2)}</pre>
                <p className="match-card-meta">{log.device_info || "Unknown device"}</p>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="dashboard-panel">
          <div className="match-empty-state">
            <p className="empty-state-copy">No activity logs match your current filters.</p>
          </div>
        </section>
      )}
    </DashboardLayout>
  );
}

function formatDate(value) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
