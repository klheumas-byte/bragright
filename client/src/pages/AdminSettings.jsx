import { useEffect, useState } from "react";
import ButtonLoadingText from "../components/ButtonLoadingText";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SuccessAlert from "../components/SuccessAlert";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getAdminLogins, getAdminSettings, updateAdminSettings } from "../services/api";

const initialSettings = {
  duplicate_window_minutes: 4,
};

export default function AdminSettings() {
  const { trackLoading } = useLoading();
  const [settings, setSettings] = useState(initialSettings);
  const [activity, setActivity] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });

  useEffect(() => {
    loadAdminSettings();
  }, []);

  async function loadAdminSettings() {
    try {
      setIsLoading(true);
      const [settingsResponse, activityResponse] = await Promise.all([
        trackLoading(() => getAdminSettings()),
        trackLoading(() => getAdminLogins()),
      ]);

      setSettings(settingsResponse.data || initialSettings);
      setActivity(activityResponse.data.logs || []);
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsLoading(false);
    }
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setSettings((currentSettings) => ({
      ...currentSettings,
      [name]: value,
    }));
  }

  async function handleSave(event) {
    event.preventDefault();

    try {
      setFeedback({ type: "", message: "" });
      setIsSaving(true);
      const response = await trackLoading(() =>
        updateAdminSettings({
          duplicate_window_minutes: Number(settings.duplicate_window_minutes),
        })
      );
      setSettings(response.data || initialSettings);
      setFeedback({ type: "success", message: response.message });
    } catch (error) {
      setFeedback({ type: "error", message: error.message });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <DashboardLayout
      title="Admin Settings"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Settings</p>
          <h2 className="feature-hero-title">Manage system settings.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Recent logins</p>
          <p className="feature-callout-value">{activity.length}</p>
        </div>
      </section>

      <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
      <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={loadAdminSettings} />

      {isLoading ? (
        <SectionLoader lines={8} message="Loading admin settings..." />
      ) : (
        <div className="admin-settings-layout">
          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Core Settings</p>
                <h2 className="panel-title">Match stabilization</h2>
              </div>
            </div>

            <form className="admin-settings-form" onSubmit={handleSave}>
              <label className="form-field">
                Duplicate window minutes
                <input
                  type="number"
                  min="1"
                  max="60"
                  name="duplicate_window_minutes"
                  value={settings.duplicate_window_minutes}
                  onChange={handleChange}
                />
              </label>

              <button className="auth-button" type="submit" disabled={isSaving}>
                <ButtonLoadingText isLoading={isSaving} loadingText="Saving...">
                  Save Settings
                </ButtonLoadingText>
              </button>
            </form>
          </section>

          <section className="dashboard-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Login Activity</p>
                <h2 className="panel-title">Recent admin-visible auth events</h2>
              </div>
            </div>

            {activity.length ? (
              <div className="admin-activity-list">
                {activity.map((event) => (
                  <article key={event.id} className="admin-activity-card">
                    <p className="admin-dispute-list-title">
                      {event.username || event.details?.email || "Unknown user"}
                    </p>
                    <p className="match-card-meta">{event.details?.email || "No email recorded"}</p>
                    <p className="match-card-meta">{formatDate(event.created_at)}</p>
                    <p className="match-card-meta">{event.device_info || "Unknown device"}</p>
                    <p className="match-card-meta">{event.ip_address || "Unknown IP"}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">No login activity recorded yet.</p>
              </div>
            )}
          </section>
        </div>
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
