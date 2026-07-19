import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ActivitySkeleton from "../components/ActivitySkeleton";
import CompetitiveSummary from "../components/CompetitiveSummary";
import {
  PerformanceInsights,
  PlayerGoalCard,
  RecentForm,
  RivalryCard,
} from "../components/CompetitiveIntelligence";
import {
  buildPerformanceInsights,
  calculateHeadToHead,
  getNextCompetitiveGoal,
  getRecentForm,
} from "../components/competitiveIntelligenceViewModel";
import ErrorState from "../components/ErrorState";
import ProfileAvatar from "../components/ProfileAvatar";
import ProfileIdentityHeader from "../components/ProfileIdentityHeader";
import ProfileMatchList from "../components/ProfileMatchList";
import SectionLoader from "../components/SectionLoader";
import SectionSkeleton from "../components/SectionSkeleton";
import SidebarIcon from "../components/SidebarIcon";
import SuccessAlert from "../components/SuccessAlert";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageSection,
} from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  getLeaderboard,
  getMyActivity,
  getMyProfile,
  getMyProfileMatches,
  updateMyProfile,
} from "../services/api";
import {
  buildOwnerCompetitiveStats,
  formatProfileDate,
  normalizeOwnerMatches,
  normalizeOwnerProfile,
  validateProfileAvatarFile,
} from "./profileViewModel";

const profileTabs = [
  { id: "overview", label: "Overview" },
  { id: "matches", label: "Match history" },
  { id: "activity", label: "Activity" },
];

export default function Profile() {
  const { user: authUser, refreshCurrentUser } = useAuth();
  const { trackLoading } = useLoading();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const tabRefs = useRef([]);
  const requestIdsRef = useRef({ profile: 0, ranking: 0, matches: 0, activity: 0 });
  const [profile, setProfile] = useState(() =>
    normalizeOwnerProfile(null, authUser)
  );
  const [ranking, setRanking] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [hasLoadedProfile, setHasLoadedProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [matches, setMatches] = useState([]);
  const [matchPagination, setMatchPagination] = useState({
    page: 1,
    limit: 8,
    total: 0,
    pages: 0,
  });
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [matchesError, setMatchesError] = useState("");
  const [hasLoadedMatches, setHasLoadedMatches] = useState(false);
  const [activity, setActivity] = useState([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [activityError, setActivityError] = useState("");
  const [hasLoadedActivity, setHasLoadedActivity] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState({
    type: "",
    message: "",
  });
  const [avatarError, setAvatarError] = useState("");
  const [editForm, setEditForm] = useState({
    username: authUser?.username || "",
    image: authUser?.profile_image || "",
  });

  useEffect(() => {
    mountedRef.current = true;
    loadProfile();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!authUser) {
      return;
    }
    setProfile((current) => normalizeOwnerProfile(current, authUser));
    loadRanking();
  }, [authUser]);

  useEffect(() => {
    if (activeTab === "matches" && !hasLoadedMatches) {
      loadMatches({ page: 1 });
    }
    if (activeTab === "activity" && !hasLoadedActivity) {
      loadActivity();
    }
  }, [activeTab, hasLoadedActivity, hasLoadedMatches]);

  const stats = useMemo(
    () => buildOwnerCompetitiveStats(profile, ranking),
    [profile, ranking]
  );
  const profileIntelligence = useMemo(() => {
    const recent = profile.overview.recent_summary;
    return {
      form: getRecentForm(recent, 5),
      insights: buildPerformanceInsights({ matches: recent, summary: profile.overview }),
      goal: getNextCompetitiveGoal({ summary: profile.overview, ranking, actions: [] }),
      rivalry: calculateHeadToHead(recent),
    };
  }, [profile.overview, ranking]);

  async function loadProfile({ forceRefresh = false } = {}) {
    const requestId = ++requestIdsRef.current.profile;
    setIsLoadingProfile(true);
    setProfileError("");
    try {
      const response = await trackLoading(() =>
        getMyProfile({ forceRefresh })
      );
      if (!isCurrentRequest("profile", requestId)) return;
      const nextProfile = normalizeOwnerProfile(response?.data, authUser);
      setProfile(nextProfile);
      setEditForm({
        username: nextProfile.username,
        image: nextProfile.profile_image,
      });
      setHasLoadedProfile(true);
    } catch (error) {
      if (!isCurrentRequest("profile", requestId)) return;
      if (!hasLoadedProfile) setProfile(normalizeOwnerProfile(null, authUser));
      setProfileError(error.message || "Profile could not be loaded.");
    } finally {
      if (isCurrentRequest("profile", requestId)) {
        setIsLoadingProfile(false);
      }
    }
  }

  async function loadRanking({ forceRefresh = false } = {}) {
    const requestId = ++requestIdsRef.current.ranking;
    try {
      const response = await trackLoading(() =>
        getLeaderboard({
          page: 1,
          limit: 20,
          playerId: authUser?.id,
          forceRefresh,
        })
      );
      if (!isCurrentRequest("ranking", requestId)) return;
      const entries = Array.isArray(response?.data?.leaderboard)
        ? response.data.leaderboard
        : [];
      setRanking(
        response?.data?.current_player ||
          entries.find((entry) => entry.id === authUser?.id) ||
          null
      );
    } catch (error) {
      if (isCurrentRequest("ranking", requestId)) {
        setRanking(null);
      }
    }
  }

  async function loadMatches({
    page = matchPagination.page,
    forceRefresh = false,
  } = {}) {
    const requestId = ++requestIdsRef.current.matches;
    setIsLoadingMatches(true);
    setMatchesError("");
    try {
      const response = await trackLoading(() =>
        getMyProfileMatches({ page, limit: 8, forceRefresh })
      );
      if (!isCurrentRequest("matches", requestId)) return;
      setMatches(normalizeOwnerMatches(response?.data?.matches));
      setMatchPagination({
        page: response?.data?.page ?? page,
        limit: response?.data?.limit ?? 8,
        total: response?.data?.total ?? response?.data?.matches?.length ?? 0,
        pages: response?.data?.pages ?? (response?.data?.matches?.length ? 1 : 0),
      });
      setHasLoadedMatches(true);
    } catch (error) {
      if (!isCurrentRequest("matches", requestId)) return;
      if (!hasLoadedMatches) setMatches([]);
      setMatchesError(error.message || "Match history could not be loaded.");
    } finally {
      if (isCurrentRequest("matches", requestId)) {
        setIsLoadingMatches(false);
      }
    }
  }

  async function loadActivity({ forceRefresh = false } = {}) {
    const requestId = ++requestIdsRef.current.activity;
    setIsLoadingActivity(true);
    setActivityError("");
    try {
      const response = await trackLoading(() =>
        getMyActivity({ page: 1, limit: 10, forceRefresh })
      );
      if (!isCurrentRequest("activity", requestId)) return;
      setActivity(
        Array.isArray(response?.data?.logs)
          ? response.data.logs.slice(0, 10)
          : []
      );
      setHasLoadedActivity(true);
    } catch (error) {
      if (!isCurrentRequest("activity", requestId)) return;
      if (!hasLoadedActivity) setActivity([]);
      setActivityError(error.message || "Activity could not be loaded.");
    } finally {
      if (isCurrentRequest("activity", requestId)) {
        setIsLoadingActivity(false);
      }
    }
  }

  function isCurrentRequest(section, requestId) {
    return (
      mountedRef.current && requestIdsRef.current[section] === requestId
    );
  }

  function beginEditing() {
    setIsEditing(true);
    setAvatarError("");
    setSaveFeedback({ type: "", message: "" });
    setEditForm({
      username: profile.username,
      image: profile.profile_image,
    });
  }

  function cancelEditing() {
    setIsEditing(false);
    setAvatarError("");
    setEditForm({
      username: profile.username,
      image: profile.profile_image,
    });
  }

  async function handleImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validationError = validateProfileAvatarFile(file);
    if (validationError) {
      setAvatarError(validationError);
      event.target.value = "";
      return;
    }
    try {
      const image = await readFileAsDataUrl(file);
      setAvatarError("");
      setEditForm((current) => ({ ...current, image }));
    } catch (error) {
      setAvatarError("Could not read the selected image.");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setSaveFeedback({ type: "", message: "" });
    try {
      const response = await trackLoading(() =>
        updateMyProfile({
          username: editForm.username,
          image: editForm.image,
        })
      );
      const nextProfile = normalizeOwnerProfile(response?.data, authUser);
      setProfile(nextProfile);
      setEditForm({
        username: nextProfile.username,
        image: nextProfile.profile_image,
      });
      setIsEditing(false);
      setSaveFeedback({
        type: "success",
        message: response?.message || "Profile updated successfully.",
      });
      await refreshCurrentUser();
    } catch (error) {
      setSaveFeedback({
        type: "error",
        message: error.message || "Could not update your profile.",
      });
    } finally {
      if (mountedRef.current) {
        setIsSaving(false);
      }
    }
  }

  function handleTabKeyDown(event, tabIndex) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    let nextIndex = tabIndex;
    if (event.key === "ArrowRight") {
      nextIndex = (tabIndex + 1) % profileTabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (tabIndex - 1 + profileTabs.length) % profileTabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = profileTabs.length - 1;
    }
    setActiveTab(profileTabs[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <DashboardLayout
      title="My Profile"
      description="Your competitive identity, record, and match history."
      sidebarRank={ranking?.rank}
    >
      <ErrorState
        message={profileError}
        onRetry={() => loadProfile({ forceRefresh: true })}
        retryLabel="Retry profile"
      />

      <ProfileIdentityHeader
        name={profile.username || "BragRight Player"}
        image={profile.profile_image}
        player={{ ...profile, rank: ranking?.rank, points: ranking?.points }}
        subtitle={profile.email}
        label="Your player identity"
        isLoading={isLoadingProfile && !hasLoadedProfile}
        loader={<SectionSkeleton lines={6} />}
        badges={
          <>
            <Badge tone={profile.status === "active" ? "success" : "neutral"}>
              {profile.status}
            </Badge>
            <Badge tone="neutral">{profile.role}</Badge>
          </>
        }
        metadata={[
          {
            id: "member-since",
            label: "Member since",
            value: formatProfileDate(profile.created_at),
          },
          {
            id: "matches",
            label: "Recorded matches",
            value: profile.overview.total_matches,
          },
          {
            id: "record",
            label: "Confirmed record",
            value: `${profile.overview.wins}-${profile.overview.losses}-${profile.overview.draws}`,
          },
        ]}
        actions={
          <>
            <Button variant="primary" size="sm" onClick={beginEditing}>
              <SidebarIcon name="profile" decorative /> Edit profile
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("matches")}
            >
              Match history
            </Button>
            <Button as={Link} to="/leaderboard" variant="ghost" size="sm">
              Leaderboard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("activity")}
            >
              Activity
            </Button>
          </>
        }
      />

      <SuccessAlert
        message={saveFeedback.type === "success" ? saveFeedback.message : ""}
      />
      <ErrorState
        message={saveFeedback.type === "error" ? saveFeedback.message : ""}
        onRetry={beginEditing}
        retryLabel="Review profile"
      />

      {isEditing ? (
        <Card
          variant="profile"
          className="dashboard-panel profile-editor-panel"
          aria-labelledby="profile-editor-title"
        >
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Owner controls</p>
              <h2 className="panel-title" id="profile-editor-title">
                Edit profile
              </h2>
            </div>
          </div>
          <form className="profile-editor-form" onSubmit={handleSubmit}>
            <Field
              label="Username"
              id="profile-username"
              value={editForm.username}
              onChange={(event) =>
                setEditForm((current) => ({
                  ...current,
                  username: event.target.value,
                }))
              }
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              description="3–32 letters, numbers, spaces, dots, underscores, or hyphens."
            />

            <div className="profile-avatar-editor">
              <ProfileAvatar
                image={editForm.image}
                name={editForm.username || profile.username}
              />
              <Field
                label="Profile image"
                id="profile-image"
                control={Input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleImageChange}
                error={avatarError}
                description="PNG, JPEG, or WebP. Maximum 180 KB."
              />
            </div>

            <div className="profile-editor-actions">
              {editForm.image ? (
                <Button
                  variant="ghost"
                  onClick={() =>
                    setEditForm((current) => ({ ...current, image: "" }))
                  }
                >
                  Remove avatar
                </Button>
              ) : null}
              <Button variant="secondary" onClick={cancelEditing}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={isSaving}
                loadingText="Saving..."
                disabled={Boolean(avatarError)}
              >
                Save profile
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <section className="profile-tabs-panel" aria-label="Profile content">
        <div className="profile-tab-row" role="tablist" aria-label="Profile sections">
          {profileTabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              id={`profile-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`profile-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              className={`profile-tab-button${
                activeTab === tab.id ? " profile-tab-button-active" : ""
              }`}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id={`profile-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`profile-tab-${activeTab}`}
          tabIndex="0"
          className="profile-tab-content"
        >
          {activeTab === "overview" ? (
            <>
              <PageSection
                title="Competitive summary"
                description="Dashboard-aligned backend statistics, with confirmed leaderboard context where available."
              >
                {isLoadingProfile && !hasLoadedProfile ? (
                  <SectionLoader lines={5} message="Loading profile statistics..." />
                ) : (
                  <CompetitiveSummary stats={stats} />
                )}
              </PageSection>

              <div className="profile-intelligence-grid">
                <PageSection title="Recent Form" description="Confirmed results only, newest first.">
                  <RecentForm items={profileIntelligence.form} emptyAction={() => navigate("/dashboard/submit-match")} />
                </PageSection>
                {profileIntelligence.goal ? (
                  <PageSection title="Personal Goal" description="A private, presentation-only target based on your record.">
                    <PlayerGoalCard goal={profileIntelligence.goal} onAction={(goal) => navigate(goal.actionPath)} />
                  </PageSection>
                ) : null}
              </div>
              {profileIntelligence.insights.length ? (
                <PageSection title="Performance Insights" description="Deterministic observations from confirmed results.">
                  <PerformanceInsights insights={profileIntelligence.insights} />
                </PageSection>
              ) : null}
              {profileIntelligence.rivalry ? (
                <PageSection title="Rivalry" description="Your most-played opponent across at least three confirmed matches.">
                  <RivalryCard rivalry={profileIntelligence.rivalry} currentPlayerId={profile.id} />
                </PageSection>
              ) : null}

              <PageSection
                title="Recent results"
                description="Your three most recent match records."
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setActiveTab("matches")}
                  >
                    Full match history
                  </Button>
                }
              >
                {profile.overview.recent_summary.length ? (
                  <ProfileMatchList
                    matches={profile.overview.recent_summary}
                    profileName="You"
                  />
                ) : (
                  <Card variant="empty" className="dashboard-panel">
                    <EmptyState
                      title="No battles yet"
                      description="Your recent match summary will appear after a match is recorded."
                      actionLabel="Submit a match"
                      onAction={() => navigate("/dashboard/submit-match")}
                    />
                  </Card>
                )}
              </PageSection>
            </>
          ) : activeTab === "matches" ? (
            <PageSection
              title="Match history"
              description={`${matchPagination.total} recorded ${matchPagination.total === 1 ? "match" : "matches"}.`}
            >
              <ErrorState
                message={matchesError}
                onRetry={() =>
                  loadMatches({
                    page: matchPagination.page,
                    forceRefresh: true,
                  })
                }
                retryLabel="Retry match history"
              />
              {isLoadingMatches && !hasLoadedMatches ? (
                <SectionLoader lines={6} message="Loading match history..." />
              ) : matches.length ? (
                <div className={isLoadingMatches ? "loading-region--refreshing" : ""} aria-busy={isLoadingMatches || undefined}>
                  {isLoadingMatches ? <span className="inline-loading-status" role="status">Refreshing match history…</span> : null}
                  <ProfileMatchList matches={matches} profileName="You" />
                  {matchPagination.pages > 1 ? (
                    <nav
                      className="profile-pagination"
                      aria-label="Profile match history pages"
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={matchPagination.page <= 1}
                        onClick={() =>
                          loadMatches({ page: matchPagination.page - 1 })
                        }
                      >
                        Previous
                      </Button>
                      <span aria-live="polite">
                        Page {matchPagination.page} of {matchPagination.pages}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={matchPagination.page >= matchPagination.pages}
                        onClick={() =>
                          loadMatches({ page: matchPagination.page + 1 })
                        }
                      >
                        Next
                      </Button>
                    </nav>
                  ) : null}
                </div>
              ) : matchesError ? null : (
                <Card variant="empty" className="dashboard-panel">
                  <EmptyState
                    title="No battles recorded"
                    description="Completed and pending match records will appear here."
                  />
                </Card>
              )}
            </PageSection>
          ) : (
            <PageSection
              title="Recent account activity"
              description="Your ten most recent profile, security, and match events."
              actions={
                <Button as={Link} to="/activity" variant="ghost" size="sm">
                  View all activity
                </Button>
              }
            >
              <ErrorState
                message={activityError}
                onRetry={() => loadActivity({ forceRefresh: true })}
                retryLabel="Retry activity"
              />
              {isLoadingActivity && !hasLoadedActivity ? (
                <ActivitySkeleton count={5} message="Loading profile activity" />
              ) : activity.length ? (
                <div className={isLoadingActivity ? "loading-region--refreshing" : ""} aria-busy={isLoadingActivity || undefined}>
                  {isLoadingActivity ? <span className="inline-loading-status" role="status">Refreshing profile activity…</span> : null}
                  <ActivityList activities={activity} compact label="Recent profile-owner activity" />
                </div>
              ) : activityError ? null : (
                <Card variant="empty" className="dashboard-panel">
                  <EmptyState
                    title="Your competitive story starts here"
                    description="Profile, sign-in, and match events will appear here."
                  />
                </Card>
              )}
            </PageSection>
          )}
        </div>
      </section>
    </DashboardLayout>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
