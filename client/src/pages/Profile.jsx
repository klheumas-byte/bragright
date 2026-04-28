import { useEffect, useMemo, useState } from "react";
import SectionSkeleton from "../components/SectionSkeleton";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  getApiAssetUrl,
  getMyActivity,
  getMyProfile,
  getMyProfileMatches,
  updateMyProfile,
} from "../services/api";

const profileTabs = [
  { id: "overview", label: "Overview" },
  { id: "matches", label: "Matches" },
  { id: "activity", label: "Activity" },
];

const emptyProfile = {
  id: "",
  username: "",
  email: "",
  profile_image: "",
  created_at: null,
  last_login: null,
  overview: {
    total_matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pending_matches: 0,
    disputed_matches: 0,
    recent_summary: [],
  },
};

export default function Profile() {
  const { user: authUser, refreshCurrentUser } = useAuth();
  const { trackLoading } = useLoading();
  const [activeTab, setActiveTab] = useState("overview");
  const [profile, setProfile] = useState(buildFallbackProfile(authUser));
  const [matches, setMatches] = useState([]);
  const [activity, setActivity] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [editForm, setEditForm] = useState({
    username: "",
    image: "",
  });

  useEffect(() => {
    loadProfilePage();
  }, []);

  useEffect(() => {
    if (!authUser) {
      return;
    }

    const fallbackProfile = buildFallbackProfile(authUser);
    setProfile((currentProfile) => mergeProfile(currentProfile, fallbackProfile));
    setEditForm((currentForm) => ({
      ...currentForm,
      username: fallbackProfile.username,
      image: fallbackProfile.profile_image,
    }));
  }, [authUser]);

  const statCards = useMemo(
    () => [
      {
        id: "total_matches",
        label: "Total Matches",
        value: profile.overview.total_matches,
        subtitle: "All competitive records tied to your account",
      },
      {
        id: "wins",
        label: "Wins",
        value: profile.overview.wins,
        subtitle: "Confirmed wins credited to you",
      },
      {
        id: "losses",
        label: "Losses",
        value: profile.overview.losses,
        subtitle: "Confirmed results that went the other way",
      },
      {
        id: "draws",
        label: "Draws",
        value: profile.overview.draws,
        subtitle: "Confirmed matches that finished level",
      },
      {
        id: "pending_matches",
        label: "Pending",
        value: profile.overview.pending_matches,
        subtitle: "Matches still waiting on review or confirmation",
      },
      {
        id: "disputed_matches",
        label: "Disputed",
        value: profile.overview.disputed_matches,
        subtitle: "Results that still need trust resolution",
      },
    ],
    [profile]
  );

  async function loadProfilePage() {
    try {
      setIsLoading(true);
      setFeedback({ type: "", message: "" });

      const [profileResult, matchesResult, activityResult] = await trackLoading(() =>
        Promise.allSettled([getMyProfile(), getMyProfileMatches(), getMyActivity()])
      );

      const nextMessages = [];

      if (profileResult.status === "fulfilled") {
        const nextProfile = normalizeProfile(profileResult.value?.data, authUser);
        setProfile(nextProfile);
        setEditForm({
          username: nextProfile.username,
          image: nextProfile.profile_image,
        });
      } else {
        const fallbackProfile = buildFallbackProfile(authUser);
        setProfile(fallbackProfile);
        setEditForm({
          username: fallbackProfile.username,
          image: fallbackProfile.profile_image,
        });
        nextMessages.push(profileResult.reason?.message || "Profile could not be loaded.");
      }

      if (matchesResult.status === "fulfilled") {
        setMatches(normalizeMatches(matchesResult.value?.data?.matches));
      } else {
        setMatches([]);
        nextMessages.push(matchesResult.reason?.message || "Match history could not be loaded.");
      }

      if (activityResult.status === "fulfilled") {
        setActivity(normalizeActivityLogs(activityResult.value?.data?.logs));
      } else {
        setActivity([]);
        nextMessages.push(activityResult.reason?.message || "Activity could not be loaded.");
      }

      if (nextMessages.length) {
        setFeedback({
          type: "error",
          message: nextMessages.join(" "),
        });
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleImageChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const image = await readFileAsDataUrl(file);
      setEditForm((currentForm) => ({
        ...currentForm,
        image,
      }));
    } catch (error) {
      const message = "Could not read the selected image.";
      setFeedback({ type: "error", message });
      alert(message);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setFeedback({ type: "", message: "" });

    try {
      const response = await trackLoading(() =>
        updateMyProfile({
          userId: profile.id || authUser?.id || "",
          username: editForm.username,
          image: editForm.image,
        })
      );

      const nextProfile = normalizeProfile(response?.data, authUser);
      setProfile(nextProfile);
      setEditForm({
        username: nextProfile.username,
        image: nextProfile.profile_image,
      });
      setIsEditing(false);
      setFeedback({
        type: "success",
        message: response?.message || "Profile updated successfully.",
      });

      await refreshCurrentUser();
      await loadProfilePage();
    } catch (error) {
      const message = error.message || "Could not update your profile.";
      setFeedback({ type: "error", message });
      alert(message);
    } finally {
      setIsSaving(false);
    }
  }

  const displayImage = getApiAssetUrl(isEditing ? editForm.image : profile.profile_image);

  if (isLoading && !profile?.id) {
    return (
      <DashboardLayout title="My Profile" description="">
        <section className="profile-hero-card">
          <SectionSkeleton lines={6} />
        </section>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="My Profile" description="">
      <section className="profile-hero-card">
        {isLoading ? (
          <SectionSkeleton lines={6} />
        ) : (
          <div className="profile-hero-layout">
            <div className="profile-identity-block">
              <div className="profile-avatar profile-avatar-large">
                {displayImage ? (
                  <img src={displayImage} alt={`${profile.username || "Player"} profile`} className="profile-avatar-image" />
                ) : (
                  getAvatarInitials(profile.username || profile.email || "BR")
                )}
              </div>

              <div className="profile-identity-copy">
                <h2 className="profile-hero-title">{profile.username || "BragRight Player"}</h2>
                <p className="profile-hero-email">{profile.email || "—"}</p>
              </div>
            </div>

            <div className="profile-meta-grid">
              <div className="profile-meta-card">
                <span className="match-score-label">Date joined</span>
                <strong>{formatDate(profile.created_at)}</strong>
              </div>
              <div className="profile-meta-card">
                <span className="match-score-label">Last login</span>
                <strong>{formatDate(profile.last_login)}</strong>
              </div>
              <div className="profile-meta-card">
                <span className="match-score-label">Role</span>
                <strong>{authUser?.role || "player"}</strong>
              </div>
              <div className="profile-meta-card">
                <span className="match-score-label">Status</span>
                <strong>{authUser?.status || "active"}</strong>
              </div>
              <div className="profile-meta-card">
                <span className="match-score-label">Actions</span>
                <button
                  type="button"
                  className="inline-action-button"
                  onClick={() => {
                    setIsEditing((currentValue) => !currentValue);
                    setFeedback({ type: "", message: "" });
                    setEditForm({
                      username: profile.username,
                      image: profile.profile_image,
                    });
                  }}
                >
                  {isEditing ? "Cancel" : "Edit Profile"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {feedback.message ? (
        <div className={`match-feedback match-feedback-${feedback.type}`}>
          <p>{feedback.message}</p>
        </div>
      ) : null}

      {isEditing ? (
        <section className="dashboard-panel profile-editor-panel">
          <form className="profile-editor-form" onSubmit={handleSubmit}>
            <label className="form-field">
              <span>Username</span>
              <input
                type="text"
                value={editForm.username}
                onChange={(event) =>
                  setEditForm((currentForm) => ({
                    ...currentForm,
                    username: event.target.value,
                  }))
                }
                maxLength={32}
              />
            </label>

            <label className="form-field">
              <span>Profile image</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageChange}
              />
            </label>

            <div className="profile-editor-actions">
              <button type="submit" className="action-card-link" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="profile-tabs-panel">
        <div className="profile-tab-row" role="tablist" aria-label="Profile sections">
          {profileTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`profile-tab-button${activeTab === tab.id ? " profile-tab-button-active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <SectionSkeleton lines={8} />
        ) : activeTab === "overview" ? (
          <div className="profile-tab-content">
            <section className="profile-stat-grid">
              {statCards.map((card) => (
                <article key={card.id} className="profile-stat-card">
                  <p className="panel-kicker">{card.label}</p>
                  <strong className="profile-stat-value">{card.value}</strong>
                  <p className="profile-stat-copy">{card.subtitle}</p>
                </article>
              ))}
            </section>

            <section className="dashboard-panel profile-summary-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Summary</p>
                  <h2 className="panel-title">Recent results</h2>
                </div>
              </div>

              {profile.overview.recent_summary.length ? (
                <div className="profile-recent-list">
                  {profile.overview.recent_summary.map((match) => (
                    <article key={match.id} className="profile-recent-card">
                      <div>
                        <p className="profile-recent-title">
                          {formatResultLabel(match.result_label)} vs {match.opponent.username}
                        </p>
                        <p className="match-card-meta">
                          {match.score_line || "—"} | {match.display_status}
                        </p>
                      </div>
                      <p className="match-card-meta">{formatDate(match.played_at)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="match-empty-state">
                  <p className="empty-state-copy">Your recent summary will appear here once matches are recorded.</p>
                </div>
              )}
            </section>
          </div>
        ) : activeTab === "matches" ? (
          <div className="profile-tab-content">
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Match History</p>
                  <h2 className="panel-title">Recent matches</h2>
                </div>
              </div>

              {matches.length ? (
                <div className="profile-match-list">
                  {matches.map((match) => (
                    <article key={match.id} className="profile-match-card">
                      <div className="profile-match-top">
                        <div>
                          <p className="profile-match-opponent">vs {match.opponent.username}</p>
                          <p className="match-card-meta">{formatDate(match.played_at)}</p>
                        </div>
                        <div className="profile-match-badges">
                          {match.status === "confirmed" ? (
                            <span className={`match-status-badge ${getResultTone(match.result)}`}>{match.result_label}</span>
                          ) : null}
                          <span className={`match-status-badge ${getStatusTone(match.status)}`}>{match.display_status}</span>
                        </div>
                      </div>

                      <div className="profile-match-score-grid">
                        <div className="match-score-line">
                          <span className="match-score-label">You</span>
                          <strong>{match.player_score}</strong>
                        </div>
                        <div className="match-score-line">
                          <span className="match-score-label">{match.opponent.username}</span>
                          <strong>{match.opponent_score}</strong>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="match-empty-state">
                  <p className="empty-state-copy">No matches yet.</p>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="profile-tab-content">
            <section className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">Activity</p>
                  <h2 className="panel-title">Recent account activity</h2>
                </div>
              </div>

              {activity.length ? (
                <div className="profile-activity-list">
                  {activity.map((item) => (
                    <article key={item.id} className="profile-activity-card">
                      <div className="profile-activity-icon" aria-hidden="true">
                        {getActivityIcon(item.action_type)}
                      </div>
                      <div className="profile-activity-body">
                        <p className="profile-activity-title">{item.action_label || "Activity recorded"}</p>
                        <p className="profile-activity-summary">
                          {formatActivityDescription(item.action_type, item.details)}
                        </p>
                      </div>
                      <p className="profile-activity-time">{formatDate(item.created_at)}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="match-empty-state">
                  <p className="empty-state-copy">No activity yet</p>
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}

function buildFallbackProfile(user) {
  return normalizeProfile(
    {
      id: user?.id || "",
      username: user?.username || "",
      email: user?.email || "",
      profile_image: user?.profile_image || "",
      created_at: user?.created_at || null,
      last_login: user?.last_login || user?.last_login_at || null,
      overview: emptyProfile.overview,
    },
    user
  );
}

function normalizeProfile(profile, authUser) {
  const source = profile || {};
  const fallback = authUser || {};
  const overview = source.overview || {};

  return {
    id: source.id || fallback.id || emptyProfile.id,
    username: source.username || fallback.username || emptyProfile.username,
    email: source.email || fallback.email || emptyProfile.email,
    profile_image: source.profile_image || fallback.profile_image || emptyProfile.profile_image,
    created_at: source.created_at || fallback.created_at || emptyProfile.created_at,
    last_login:
      source.last_login ||
      source.last_login_at ||
      fallback.last_login ||
      fallback.last_login_at ||
      emptyProfile.last_login,
    overview: {
      total_matches: overview.total_matches ?? 0,
      wins: overview.wins ?? 0,
      losses: overview.losses ?? 0,
      draws: overview.draws ?? 0,
      pending_matches: overview.pending_matches ?? 0,
      disputed_matches: overview.disputed_matches ?? 0,
      recent_summary: normalizeMatches(overview.recent_summary || []),
    },
  };
}

function mergeProfile(currentProfile, nextProfile) {
  return {
    ...currentProfile,
    ...nextProfile,
    overview: {
      ...currentProfile.overview,
      ...nextProfile.overview,
    },
  };
}

function normalizeMatches(matches) {
  return Array.isArray(matches)
    ? matches.map((match) => ({
        id: match?.id || "",
        opponent: {
          id: match?.opponent?.id || "",
          username: match?.opponent?.username || "Unknown opponent",
        },
        result: match?.result || "pending",
        result_label: match?.status === "confirmed" ? match?.result_label || "-" : "",
        status: match?.status || "pending_result",
        display_status: match?.display_status || formatStatus(match?.status || "pending_result"),
        player_score: match?.player_score ?? 0,
        opponent_score: match?.opponent_score ?? 0,
        score_line:
          match?.player_score == null && match?.opponent_score == null
            ? "No result submitted"
            : match?.score_line || `${match?.player_score ?? 0} - ${match?.opponent_score ?? 0}`,
        played_at: match?.played_at || match?.created_at || null,
      }))
    : [];
}

function normalizeActivityLogs(logs) {
  return Array.isArray(logs)
    ? logs.map((log) => ({
        id: log?.id || "",
        action_type: log?.action_type || "",
        action_label: log?.action_label || "Activity recorded",
        details: log?.details || null,
        created_at: log?.created_at || null,
      }))
    : [];
}

function getActivityIcon(actionType) {
  const iconMap = {
    login: "🔐",
    match_submitted: "⚽",
    match_confirmed: "✅",
    match_disputed: "⚠️",
    proof_uploaded: "🖼️",
    password_reset: "🔑",
    role_changed: "🛡️",
    settings_updated: "⚙️",
  };

  return iconMap[actionType] || "•";
}

function formatActivityDescription(actionType, details) {
  const formattedDetails = formatActivityDetails(details);
  const safeDetails = details && typeof details === "object" && !Array.isArray(details) ? details : {};

  if (actionType === "login") {
    return formattedDetails || "Signed in to BragRight.";
  }

  if (actionType === "match_submitted") {
    if (safeDetails.player_score != null || safeDetails.opponent_score != null) {
      return `Submitted a match result. Score: ${safeDetails.player_score ?? "-"}-${safeDetails.opponent_score ?? "-"}`;
    }

    return formattedDetails || "Submitted a match result.";
  }

  if (actionType === "match_confirmed") {
    return formattedDetails || "Confirmed a match result.";
  }

  if (actionType === "match_disputed") {
    return formattedDetails || "Disputed a submitted result.";
  }

  if (actionType === "proof_uploaded") {
    return formattedDetails || "Uploaded proof for a match.";
  }

  if (actionType === "password_reset") {
    return formattedDetails || "Password reset activity recorded.";
  }

  if (actionType === "role_changed") {
    return formattedDetails || "Role change recorded.";
  }

  if (actionType === "settings_updated" || actionType === "profile_updated") {
    return formattedDetails || "Settings updated.";
  }

  return formattedDetails || "Recorded account activity.";
}

function formatActivityDetails(details) {
  if (details == null || details === "") {
    return "";
  }

  if (Array.isArray(details)) {
    return details
      .map((value) => formatActivityValue(value))
      .filter(Boolean)
      .join(" • ");
  }

  if (typeof details !== "object") {
    return formatActivityValue(details);
  }

  return Object.entries(details)
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${formatActivityKey(key)}: ${formatActivityValue(value)}`)
    .filter(Boolean)
    .join(" • ");
}

function formatActivityKey(value) {
  return String(value || "detail")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatActivityValue(value) {
  if (value == null || value === "") {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => formatActivityValue(entry)).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, entry]) => entry != null && entry !== "")
      .map(([key, entry]) => `${formatActivityKey(key)}: ${formatActivityValue(entry)}`)
      .filter(Boolean)
      .join(", ");
  }

  return String(value);
}

function getAvatarInitials(value) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function getResultTone(result) {
  if (result === "win") {
    return "match-status-confirmed";
  }

  if (result === "loss") {
    return "match-status-disputed";
  }

  return "match-status-pending";
}

function getStatusTone(status) {
  if (status === "confirmed") {
    return "match-status-confirmed";
  }

  if (status === "disputed") {
    return "match-status-disputed";
  }

  if (["rejected", "cancelled", "expired"].includes(status)) {
    return "match-status-rejected";
  }

  return "match-status-pending";
}

function formatResultLabel(value) {
  if (value === "W") {
    return "Win";
  }

  if (value === "L") {
    return "Loss";
  }

  if (value === "D") {
    return "Draw";
  }

  return "Match";
}

function formatStatus(value) {
  return String(value || "unknown")
    .replace("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(date) {
  if (!date) {
    return "—";
  }

  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) {
    return "—";
  }

  return parsedDate.toLocaleString();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}
