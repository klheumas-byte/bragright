import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ActivitySkeleton from "../components/ActivitySkeleton";
import {
  CompetitiveMoments,
  CompetitivePulse,
  EngagementNotificationCard,
  PlayerHighlightGrid,
} from "../components/EngagementCards";
import {
  NextBestAction,
  PerformanceInsights,
  PlayerGoalCard,
  RecentForm,
  RivalryCard,
} from "../components/CompetitiveIntelligence";
import CompetitiveIntelligenceSkeleton from "../components/CompetitiveIntelligenceSkeleton";
import {
  CompetitivePulseSkeleton,
  HighlightGridSkeleton,
  NotificationListSkeleton,
} from "../components/EngagementSkeletons";
import RichMatchCard from "../components/RichMatchCard";
import PlayerIdentity from "../components/PlayerIdentity";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SectionSkeleton from "../components/SectionSkeleton";
import StatCard from "../components/StatCard";
import SidebarIcon from "../components/SidebarIcon";
import TrophyWatermark from "../components/TrophyWatermark";
import { Badge, Button, Card, EmptyState, PageSection } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  getDashboardSummary,
  getLeaderboard,
  getMyActivity,
} from "../services/api";
import {
  buildCompetitiveMoments,
  buildCompetitivePulse,
  buildPlayerHighlights,
  normalizeEngagementNotifications,
} from "../components/engagementViewModel";
import {
  buildPerformanceInsights,
  calculateHeadToHead,
  getNextBestAction,
  getNextCompetitiveGoal,
  getPendingPlayerActions,
  getRecentForm,
} from "../components/competitiveIntelligenceViewModel";
import {
  buildRankingContext,
  EMPTY_ACTION_CENTER,
  EMPTY_DASHBOARD_SUMMARY,
  getPrimaryDashboardAction,
  normalizeActionCenter,
  normalizeDashboardSummary,
} from "./dashboardViewModel";

const quickActions = [
  {
    id: "submit-match",
    label: "Submit a match",
    description: "Challenge a player or record a result.",
    path: "/dashboard/submit-match",
    icon: "matches",
  },
  {
    id: "matches",
    label: "My matches",
    description: "Review requests, results, and disputes.",
    path: "/dashboard/matches",
    icon: "matches",
  },
  {
    id: "leaderboard",
    label: "Leaderboard",
    description: "See the confirmed competitive standings.",
    path: "/leaderboard",
    icon: "leaderboard",
  },
  {
    id: "profile",
    label: "Profile",
    description: "Review your public player identity.",
    path: "/profile",
    icon: "profile",
  },
];

export default function Dashboard() {
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const requestIdsRef = useRef({ summary: 0, ranking: 0, activity: 0 });
  const [summary, setSummary] = useState(EMPTY_DASHBOARD_SUMMARY);
  const [actionCenter, setActionCenter] = useState(EMPTY_ACTION_CENTER);
  const [ranking, setRanking] = useState({ player: null, neighbors: [] });
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState({
    summary: true,
    ranking: true,
    activity: true,
  });
  const [loaded, setLoaded] = useState({ summary: false, ranking: false, activity: false });
  const [errors, setErrors] = useState({
    summary: "",
    ranking: "",
    activity: "",
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    loadDashboardSummary();
    loadRanking();
    loadActivity();
  }, []);

  async function loadDashboardSummary({ forceRefresh = false } = {}) {
    const requestId = ++requestIdsRef.current.summary;
    setSectionLoading("summary", true);
    setSectionError("summary", "");

    try {
      const response = await trackLoading(() =>
        getDashboardSummary({ forceRefresh })
      );
      if (!isCurrentRequest("summary", requestId)) {
        return;
      }
      setSummary(
        normalizeDashboardSummary(response?.data?.summary || response?.data)
      );
      setActionCenter(
        normalizeActionCenter(response?.data?.action_center)
      );
      setLoaded((current) => ({ ...current, summary: true }));
    } catch (error) {
      if (!isCurrentRequest("summary", requestId)) {
        return;
      }
      setSectionError("summary", error.message);
    } finally {
      if (isCurrentRequest("summary", requestId)) {
        setSectionLoading("summary", false);
      }
    }
  }

  async function loadRanking({ forceRefresh = false } = {}) {
    const requestId = ++requestIdsRef.current.ranking;
    setSectionLoading("ranking", true);
    setSectionError("ranking", "");

    try {
      const response = await trackLoading(() =>
        getLeaderboard({
          page: 1,
          limit: 20,
          playerId: user?.id,
          forceRefresh,
        })
      );
      if (!isCurrentRequest("ranking", requestId)) {
        return;
      }
      setRanking(
        buildRankingContext(
          response?.data?.leaderboard,
          user?.id,
          response?.data?.current_player,
          response?.data?.nearby_players
        )
      );
      setLoaded((current) => ({ ...current, ranking: true }));
    } catch (error) {
      if (!isCurrentRequest("ranking", requestId)) {
        return;
      }
      setSectionError("ranking", error.message);
    } finally {
      if (isCurrentRequest("ranking", requestId)) {
        setSectionLoading("ranking", false);
      }
    }
  }

  async function loadActivity({ forceRefresh = false } = {}) {
    const requestId = ++requestIdsRef.current.activity;
    setSectionLoading("activity", true);
    setSectionError("activity", "");

    try {
      const response = await trackLoading(() =>
        getMyActivity({ page: 1, limit: 5, forceRefresh })
      );
      if (!isCurrentRequest("activity", requestId)) {
        return;
      }
      setActivity(
        Array.isArray(response?.data?.logs)
          ? response.data.logs.slice(0, 5)
          : []
      );
      setLoaded((current) => ({ ...current, activity: true }));
    } catch (error) {
      if (!isCurrentRequest("activity", requestId)) {
        return;
      }
      setSectionError("activity", error.message);
    } finally {
      if (isCurrentRequest("activity", requestId)) {
        setSectionLoading("activity", false);
      }
    }
  }

  function isCurrentRequest(section, requestId) {
    return (
      isMountedRef.current && requestIdsRef.current[section] === requestId
    );
  }

  function setSectionLoading(section, value) {
    if (isMountedRef.current) {
      setLoading((current) => ({ ...current, [section]: value }));
    }
  }

  function setSectionError(section, message) {
    if (isMountedRef.current) {
      setErrors((current) => ({ ...current, [section]: message }));
    }
  }

  const pendingActions = useMemo(
    () => getPendingPlayerActions(actionCenter.items),
    [actionCenter.items]
  );
  const primaryAction = getPrimaryDashboardAction({ ...actionCenter, items: pendingActions });
  const primaryDestination = buildActionDestination({
    action_url: primaryAction.path,
    related_match_id: primaryAction.matchId,
  });
  const displayName = user?.username || user?.email || "Player";
  const stats = buildStats(summary, ranking.player);
  const notifications = useMemo(
    () => normalizeEngagementNotifications(pendingActions),
    [pendingActions]
  );
  const highlights = useMemo(
    () => buildPlayerHighlights(summary, ranking.player),
    [ranking.player, summary]
  );
  const moments = useMemo(
    () => buildCompetitiveMoments(summary, ranking.player),
    [ranking.player, summary]
  );
  const pulse = useMemo(
    () => buildCompetitivePulse({
      recentMatches: summary.recent_summary,
      recentActivity: activity,
      actionsRequired: actionCenter.summary.actions_required,
    }),
    [actionCenter.summary.actions_required, activity, summary.recent_summary]
  );
  const nextAction = useMemo(
    () => getNextBestAction(pendingActions),
    [pendingActions]
  );
  const recentForm = useMemo(
    () => getRecentForm(summary.recent_summary, 5),
    [summary.recent_summary]
  );
  const insights = useMemo(
    () => buildPerformanceInsights({ matches: summary.recent_summary, summary, actionSummary: actionCenter.summary }),
    [actionCenter.summary, summary]
  );
  const goal = useMemo(
    () => getNextCompetitiveGoal({ summary, ranking: ranking.player, actions: pendingActions }),
    [pendingActions, ranking.player, summary]
  );
  const rivalry = useMemo(
    () => calculateHeadToHead(summary.recent_summary),
    [summary.recent_summary]
  );

  return (
    <DashboardLayout
      title="Competitive Command Center"
      description="Track your record, ranking, rivals, and next move."
      sidebarRank={ranking.player?.rank}
    >
      <Card
        as="section"
        variant="dashboard"
        className="feature-hero-card dashboard-welcome-card"
        aria-labelledby="dashboard-welcome-title"
      >
        <TrophyWatermark className="arena-hero-watermark" />
        <div className="dashboard-welcome-identity">
          <div>
            <p className="section-label">Player dashboard</p>
            <PlayerIdentity
              player={{ ...user, rank: ranking.player?.rank, points: ranking.player?.points }}
              variant="compact"
              showUsername={false}
              isCurrent
              className="dashboard-player-identity"
            />
            <h2
              className="feature-hero-title dashboard-welcome-title"
              id="dashboard-welcome-title"
            >
              Welcome back, {displayName}.
            </h2>
            <p className="dashboard-welcome-copy">
              {getWelcomeMessage({
                isLoading: loading.summary,
                error: errors.summary,
                actionCount: pendingActions.length,
              })}
            </p>
          </div>
        </div>

        <div className="dashboard-welcome-actions">
          <Button
            variant="primary"
            isLoading={loading.summary}
            loadingText="Loading action..."
            onClick={() => navigate(primaryDestination)}
          >
            <SidebarIcon name={primaryDestination === "/dashboard/submit-match" ? "matches" : "activity"} decorative />
            {primaryAction.label}
          </Button>
          {!user?.profile_image ? (
            <Button as={Link} to="/profile" variant="secondary">
              Complete profile
            </Button>
          ) : null}
        </div>
      </Card>

      <PageSection
        className="dashboard-quick-section"
        title="Quick actions"
        description="Go directly to your most common player tasks."
      >
        <nav
          className="dashboard-quick-actions"
          aria-label="Dashboard quick actions"
        >
          {quickActions.map((action) => (
            <Card
              as={Link}
              variant="information"
              className="dashboard-quick-action"
              key={action.id}
              to={action.path}
            >
              <span className="dashboard-quick-action-icon" aria-hidden="true">
                <SidebarIcon name={action.icon} decorative />
              </span>
              <span className="dashboard-quick-action-copy">
                <strong>{action.label}</strong>
                <small>{action.description}</small>
              </span>
              <span className="dashboard-quick-action-arrow" aria-hidden="true">
                {"\u2192"}
              </span>
            </Card>
          ))}
        </nav>
      </PageSection>

      <PageSection
        title="Action Required"
        description="Match responsibilities and notifications that require a decision."
        actions={
          !loading.summary && !errors.summary ? (
            <Badge
              tone={actionCenter.items.length ? "warning" : "success"}
              aria-live="polite"
            >
              {pendingActions.length
                ? `${pendingActions.length} to review`
                : "All caught up"}
            </Badge>
          ) : null
        }
      >
        <ErrorState
          message={errors.summary}
          onRetry={() => loadDashboardSummary({ forceRefresh: true })}
          retryLabel="Retry dashboard"
        />
        {loading.summary && loaded.summary ? <span className="inline-loading-status" role="status">Refreshing dashboard…</span> : null}

        {loading.summary && !loaded.summary ? (
          <NotificationListSkeleton count={3} />
        ) : errors.summary && !loaded.summary ? null : pendingActions.length ? (
          <div className="engagement-notification-list">
            {notifications.map((notification) => (
              <EngagementNotificationCard
                key={notification.id}
                notification={notification}
                onAction={(item) => navigate(buildActionDestination({ action_path: item.actionPath, related_match_id: item.matchId }))}
              />
            ))}
          </div>
        ) : (
          <Card variant="empty" className="dashboard-panel">
            <EmptyState
              title="No actions required"
              description="New match requests, result confirmations, and dispute updates will appear here."
            />
          </Card>
        )}
      </PageSection>

      <PageSection
        title="Next Best Action"
        description="The highest-priority supported step in your current competitive workflow."
      >
        {loading.summary && !loaded.summary ? (
          <CompetitiveIntelligenceSkeleton variant="action" />
        ) : errors.summary && !loaded.summary ? null : (
          <NextBestAction action={nextAction} onAction={(item) => navigate(buildActionDestination({ action_path: item.actionPath, related_match_id: item.matchId }))} />
        )}
      </PageSection>

      <PageSection
        title="Competitive Summary"
        description="Your confirmed record and current leaderboard standing."
      >
        <ErrorState
          message={errors.summary}
          onRetry={() => loadDashboardSummary({ forceRefresh: true })}
          retryLabel="Retry statistics"
        />
        <section
          className="stat-grid stat-grid-wide"
          aria-label="Player performance metrics"
        >
          {loading.summary && !loaded.summary
            ? stats.map((stat) => (
                <Card
                  as="article"
                  variant="loading"
                  key={stat.id}
                  className="stat-card"
                  aria-label={`Loading ${stat.title}`}
                >
                  <SectionSkeleton lines={3} />
                </Card>
              ))
            : errors.summary && !loaded.summary
              ? null
              : stats.map((stat) => (
                <StatCard
                  key={stat.id}
                  title={stat.title}
                  value={stat.value}
                  subtitle={stat.subtitle}
                  icon={stat.icon}
                  tone={stat.tone}
                  emphasis={stat.emphasis}
                />
              ))}
        </section>
      </PageSection>

      <div className="dashboard-insight-grid competitive-intelligence-grid">
        <PageSection title="Recent Form" description="Newest-first results from confirmed matches only.">
          {loading.summary && !loaded.summary ? <CompetitiveIntelligenceSkeleton variant="form" /> : (
            <RecentForm items={recentForm} emptyAction={() => navigate("/dashboard/submit-match")} />
          )}
        </PageSection>

        <PageSection title="Personal Goal" description="A presentation-only target based on your current record.">
          {loading.summary && !loaded.summary ? <CompetitiveIntelligenceSkeleton variant="goal" /> : goal ? (
            <PlayerGoalCard goal={goal} onAction={(item) => navigate(item.actionPath)} />
          ) : (
            <Card variant="empty"><EmptyState title="No target needed right now" description="Your next target will appear when your record or standing supports one." /></Card>
          )}
        </PageSection>
      </div>

      {insights.length ? (
        <PageSection title="Performance Insights" description="Deterministic observations from your confirmed record and pending actions.">
          <PerformanceInsights insights={insights} />
        </PageSection>
      ) : null}

      {rivalry ? (
        <PageSection title="Rivalry" description="Your most-played opponent across at least three confirmed matches.">
          <RivalryCard rivalry={rivalry} currentPlayerId={user?.id} />
        </PageSection>
      ) : null}

      <PageSection
        title="Competitive highlights"
        description="Real milestones and standing drawn from your confirmed record."
      >
        {loading.summary || loading.ranking ? (
          <HighlightGridSkeleton />
        ) : highlights.length ? (
          <>
            <PlayerHighlightGrid highlights={highlights} />
            <CompetitiveMoments moments={moments} />
          </>
        ) : (
          <Card variant="empty"><EmptyState title="Highlights are waiting" description="Complete a confirmed match to begin building your competitive highlights." actionLabel="Challenge a player" onAction={() => navigate("/dashboard/submit-match")} /></Card>
        )}
      </PageSection>

      <PageSection
        title="Competitive pulse"
        description="Recent competitive activity supported by your existing match and event data."
      >
        {loading.summary || loading.activity ? <CompetitivePulseSkeleton /> : <CompetitivePulse items={pulse} />}
      </PageSection>

      <div className="dashboard-insight-grid">
        <PageSection
          title="Recent matches"
          description="Your latest match records and their current status."
          actions={
            <Button as={Link} to="/dashboard/matches" variant="ghost" size="sm">
              View all matches
            </Button>
          }
        >
          <ErrorState
            message={errors.summary}
            onRetry={() => loadDashboardSummary({ forceRefresh: true })}
            retryLabel="Retry recent matches"
          />
          {loading.summary && !loaded.summary ? (
            <SectionLoader lines={5} message="Loading recent matches..." />
          ) : errors.summary && !loaded.summary ? null : summary.recent_summary.length ? (
            <div className="dashboard-compact-list rich-match-card-list">
              {summary.recent_summary.map((match) => (
                <RichMatchCard
                  key={match.id}
                  match={match}
                  currentUserId={user?.id}
                  currentUserName={user?.username}
                  variant="compact"
                  detailPath={buildMatchDestination(match.id)}
                />
              ))}
            </div>
          ) : (
            <Card variant="empty" className="dashboard-panel">
              <EmptyState
                title="No battles yet"
                description="Submit or schedule a match to begin building your competitive record."
                actionLabel="Submit a match"
                onAction={() => navigate("/dashboard/submit-match")}
              />
            </Card>
          )}
        </PageSection>

        <PageSection
          title="Ranking context"
          description="Your current confirmed standing and nearby competitors."
          actions={
            <Button as={Link} to="/leaderboard" variant="ghost" size="sm">
              Full leaderboard
            </Button>
          }
        >
        <ErrorState
          message={errors.ranking}
            onRetry={() => loadRanking({ forceRefresh: true })}
          retryLabel="Retry ranking"
        />
          {loading.ranking && loaded.ranking ? <span className="inline-loading-status" role="status">Refreshing ranking…</span> : null}
          {loading.ranking && !loaded.ranking ? (
            <SectionLoader lines={5} message="Loading ranking context..." />
          ) : ranking.player ? (
            <Card
              variant="dashboard"
              className="dashboard-panel dashboard-ranking-card"
            >
              <div className="dashboard-ranking-summary">
                <div>
                  <p className="panel-kicker">Current rank</p>
                  <strong className="dashboard-ranking-position">
                    #{ranking.player.rank}
                  </strong>
                </div>
                <div className="dashboard-ranking-points">
                  <strong>{ranking.player.points}</strong>
                  <span>points</span>
                </div>
              </div>
              <div
                className="dashboard-ranking-neighbors"
                aria-label="Nearby leaderboard positions"
              >
                {ranking.neighbors.map((player) => (
                  <Link
                    key={player.id}
                    to={`/players/${player.id}`}
                    className={`dashboard-ranking-row${
                      player.id === user?.id
                        ? " dashboard-ranking-row-current"
                        : ""
                    }`}
                    aria-current={player.id === user?.id ? "true" : undefined}
                  >
                    <span>#{player.rank}</span>
                    <strong>{player.username}</strong>
                    <span>{player.points} pts</span>
                  </Link>
                ))}
              </div>
            </Card>
          ) : (
            <Card variant="empty" className="dashboard-panel">
              <EmptyState
                title="Ranking not available yet"
                description="Your ranking will appear after confirmed competitive results are included in the standings."
              />
            </Card>
          )}
        </PageSection>
      </div>

      <PageSection
        title="Recent activity"
        description="The latest security, profile, and match events on your account."
        actions={
          <Button as={Link} to="/activity" variant="ghost" size="sm">
            View all activity
          </Button>
        }
      >
        <ErrorState
          message={errors.activity}
          onRetry={() => loadActivity({ forceRefresh: true })}
          retryLabel="Retry activity"
        />
        {loading.activity && loaded.activity ? <span className="inline-loading-status" role="status">Refreshing activity…</span> : null}
        {loading.activity && !loaded.activity ? (
          <ActivitySkeleton count={5} message="Loading recent activity" />
        ) : activity.length ? (
          <ActivityList activities={activity} compact label="Recent account activity" />
        ) : (
          <Card variant="empty" className="dashboard-panel">
            <EmptyState
              title="Your competitive story starts here"
              description="New sign-ins, profile updates, and match events will appear here."
            />
          </Card>
        )}
      </PageSection>
    </DashboardLayout>
  );
}

function buildStats(summary, ranking) {
  const confirmedMatches = summary.wins + summary.losses + summary.draws;
  return [
    {
      id: "total-matches",
      title: "Completed Matches",
      value: String(confirmedMatches),
      subtitle: "Confirmed results only",
      icon: "matches",
      tone: "primary",
      emphasis: confirmedMatches > 0,
    },
    {
      id: "wins",
      title: "Wins",
      value: String(summary.wins),
      subtitle: "Confirmed wins",
      icon: "trophy",
      tone: "success",
      emphasis: summary.wins > 0,
    },
    {
      id: "losses",
      title: "Losses",
      value: String(summary.losses),
      subtitle: "Confirmed losses",
      icon: "disputes",
      tone: "danger",
      emphasis: false,
    },
    {
      id: "draws",
      title: "Draws",
      value: String(summary.draws),
      subtitle: "Confirmed draws",
      icon: "balance",
      tone: "warning",
      emphasis: false,
    },
    {
      id: "current-rank",
      title: "Current Rank",
      value: ranking ? `#${ranking.rank}` : "—",
      subtitle: "Confirmed leaderboard position",
      icon: "crown",
      tone: "primary",
      emphasis: Boolean(ranking),
    },
    {
      id: "points",
      title: "Points",
      value: ranking ? String(ranking.points) : "—",
      subtitle: "Confirmed leaderboard points",
      icon: "bolt",
      tone: "secondary",
      emphasis: false,
    },
  ];
}

function buildActionDestination(item) {
  const rawDestination =
    item?.action_url || item?.action_path || "/dashboard/matches";
  const destination = new URL(rawDestination, window.location.origin);
  const matchId = item?.related_match_id || item?.match_id;

  if (
    destination.pathname.endsWith("/dashboard/matches") &&
    matchId &&
    !destination.searchParams.get("matchId")
  ) {
    destination.searchParams.set("matchId", matchId);
  }

  destination.searchParams.set("open", String(Date.now()));
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function buildMatchDestination(matchId) {
  if (!matchId) {
    return "/dashboard/matches";
  }
  return `/dashboard/matches?matchId=${encodeURIComponent(matchId)}`;
}

function getWelcomeMessage({ isLoading, error, actionCount }) {
  if (isLoading) {
    return "Loading your latest competitive summary.";
  }
  if (error) {
    return "Some dashboard details could not be loaded. You can retry below.";
  }
  if (actionCount) {
    return `You have ${actionCount} match ${
      actionCount === 1 ? "item" : "items"
    } waiting for attention.`;
  }
  return "Your competitive record is up to date. You can start your next match when ready.";
}
