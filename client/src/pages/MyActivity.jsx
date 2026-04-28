import { useEffect, useState } from "react";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getMyActivity } from "../services/api";

export default function MyActivity() {
  const { trackLoading } = useLoading();
  const [logs, setLogs] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    loadMyActivity();
  }, []);

  async function loadMyActivity() {
    try {
      setIsLoading(true);
      const response = await trackLoading(() => getMyActivity());
      setLogs(response.data.logs || []);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <DashboardLayout
      title="My Activity"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Activity</p>
          <h2 className="feature-hero-title">Your recent account activity.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Recent events</p>
          <p className="feature-callout-value">{logs.length}</p>
        </div>
      </section>

      <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={loadMyActivity} />

      {isLoading ? (
        <SectionLoader lines={6} message="Loading your activity..." />
      ) : logs.length ? (
        <section className="admin-activity-list">
          {logs.map((log) => (
            <article key={log.id} className="admin-activity-card">
              <p className="admin-dispute-list-title">{log.action_label}</p>
              <p className="match-card-meta">{log.action_type}</p>
              <p className="match-card-meta">{formatDate(log.created_at)}</p>
              <div className="match-dispute-note-panel">
                <p className="match-score-label">Summary</p>
                <p className="match-dispute-note-copy">{log.summary || "Recorded account activity."}</p>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="dashboard-panel">
          <div className="match-empty-state">
            <p className="empty-state-copy">No activity has been recorded for your account yet.</p>
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
