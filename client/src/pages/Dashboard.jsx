import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ActivitySkeleton from "../components/ActivitySkeleton";
import CompetitiveBadge from "../components/CompetitiveBadge";
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
  getApiAssetUrl,
  getDashboardSummary,
  getLeaderboard,
  getMyActivity,
} from "../services/api";
import {
  buildRankingContext,
  EMPTY_ACTION_CENTER,
  EMPTY_DASHBOARD_SUMMARY,
  formatActionType,
  formatDashboardDate,
  getMatchStatusTone,
  getPrimaryDashboardAction,
  normalizeActionCenter,
  normalizeDashboardSummary,
} from "./dashboardViewModel";
import { getMatchStatusPresentation } from "./matchPresentation";

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
    } catch (error) {
      if (!isCurrentRequest("summary", requestId)) {
        return;
      }
      setSectionError("summary", error.message);
      setSummary(EMPTY_DASHBOARD_SUMMARY);
      setActionCenter(EMPTY_ACTION_CENTER);
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
    } catch (error) {
      if (!isCurrentRequest("ranking", requestId)) {
        return;
      }
      setSectionError("ranking", error.message);
      setRanking({ player: null, neighbors: [] });
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
    } catch (error) {
      if (!isCurrentRequest("activity", requestId)) {
        return;
      }
      setSectionError("activity", error.message);
      setActivity([]);
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

  const primaryAction = getPrimaryDashboardAction(actionCenter);
  const primaryDestination = buildActionDestination({
    action_url: primaryAction.path,
    related_match_id: primaryAction.matchId,
  });
  const displayName = user?.username || user?.email || "Player";
  const avatarImage = user?.profile_image
    ? getApiAssetUrl(user.profile_image)
    : "";
  const avatarInitials = getInitials(displayName);
  const stats = buildStats(summary, ranking.player);

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
          <div className="dashboard-welcome-avatar" aria-hidden="true">
            {avatarImage ? (
              <img src={avatarImage} alt="" />
            ) : (
              avatarInitials
            )}
          </div>
          <div>
            <p className="section-label">Player dashboard</p>
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
                actionCount: actionCenter.items.length,
              })}
            </p>
            {!loading.ranking && ranking.player ? (
              <div className="dashboard-welcome-meta" aria-label="Current ranking">
                <CompetitiveBadge kind="rank" value={ranking.player.rank} />
                <CompetitiveBadge kind="points" value={ranking.player.points} />
              </div>
            ) : null}
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
        title="Needs your attention"
        description="Match responsibilities and notifications that require a decision."
        actions={
          !loading.summary && !errors.summary ? (
            <Badge
              tone={actionCenter.items.length ? "warning" : "success"}
              aria-live="polite"
            >
              {actionCenter.items.length
                ? `${actionCenter.items.length} to review`
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

        {loading.summary ? (
          <SectionLoader
            lines={4}
            message="Loading your match responsibilities..."
          />
        ) : errors.summary ? null : actionCenter.items.length ? (
          <Card
            variant="dashboard"
            className="dashboard-panel dashboard-attention-panel"
          >
            <div className="dashboard-review-stack">
              {actionCenter.items.map((item) => (
                <article key={item.id} className="review-item-card">
                  <div className="review-item-copy">
                    <div className="dashboard-item-labels">
                      <Badge tone={getActionTone(item.type)}>
                        {formatActionType(item.type)}
                      </Badge>
                      <span className="review-item-time">
                        {formatDashboardDate(item.created_at)}
                      </span>
                    </div>
                    <h3 className="review-item-title">{item.message}</h3>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="inline-action-link"
                    onClick={() => navigate(buildActionDestination(item))}
                  >
                    {item.action_label || "Review now"}
                  </Button>
                </article>
              ))}
            </div>
          </Card>
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
          {loading.summary
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
            : errors.summary
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
          {loading.summary ? (
            <SectionLoader lines={5} message="Loading recent matches..." />
          ) : errors.summary ? null : summary.recent_summary.length ? (
            <Card
              variant="dashboard"
              className="dashboard-panel dashboard-list-panel"
            >
              <div className="dashboard-compact-list">
                {summary.recent_summary.map((match) => (
                  <Link
                    className="dashboard-match-row"
                    key={match.id}
                    to={buildMatchDestination(match.id)}
                  >
                    <span className="dashboard-match-result">
                      {match.result_label || getResultLabel(match.result)}
                    </span>
                    <span className="dashboard-match-copy">
                      <strong>
                        vs {match.opponent?.username || "Unknown opponent"}
                      </strong>
                      <small>
                        {match.score_line || "No result submitted"} ·{" "}
                        {formatDashboardDate(
                          match.played_at || match.created_at,
                          "Date pending"
                        )}
                      </small>
                    </span>
                    <Badge tone={getMatchStatusTone(match)}>
                      {getMatchStatusPresentation(match.status).label}
                    </Badge>
                  </Link>
                ))}
              </div>
            </Card>
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
          {loading.ranking ? (
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
        {loading.activity ? (
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
  return [
    {
      id: "total-matches",
      title: "Total Matches",
      value: String(summary.total_matches),
      subtitle: "All recorded match workflows",
      icon: "matches",
      tone: "primary",
      emphasis: summary.total_matches > 0,
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

function getInitials(value) {
  return String(value)
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function getResultLabel(result) {
  const labels = { win: "W", loss: "L", draw: "D" };
  return labels[String(result || "").toLowerCase()] || "—";
}

function getActionTone(type) {
  if (type === "dispute_status") {
    return "danger";
  }
  if (
    type === "match_request" ||
    type === "result_awaiting_confirmation"
  ) {
    return "warning";
  }
  return "info";
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
