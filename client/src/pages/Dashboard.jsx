import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import MomentumChart from "../components/MomentumChart";
import SectionSkeleton from "../components/SectionSkeleton";
import StatCard from "../components/StatCard";
import TopPerformers from "../components/TopPerformers";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getDashboardActionCenter, getDashboardSummary } from "../services/api";

const momentumData = [
  { id: "monday", label: "Mon", value: 42 },
  { id: "tuesday", label: "Tue", value: 58 },
  { id: "wednesday", label: "Wed", value: 74 },
  { id: "thursday", label: "Thu", value: 67 },
  { id: "friday", label: "Fri", value: 88 },
  { id: "saturday", label: "Sat", value: 96 },
];

const topPerformers = [
  { id: "maya-chen", name: "Maya Chen", points: 1280 },
  { id: "jordan-lee", name: "Jordan Lee", points: 1195 },
  { id: "ava-brooks", name: "Ava Brooks", points: 1110 },
];

const emptySummary = {
  total_matches: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  pending_matches: 0,
  disputed_matches: 0,
  actions_required: 0,
};

const emptyActionCenter = {
  summary: {
    actions_required: 0,
    pending_confirmations: 0,
    disputed_matches: 0,
    review_required_items: 0,
  },
  actions: [],
  items: [],
  messages: {
    has_pending_confirmations: false,
    has_disputed_notices: false,
  },
};

export default function Dashboard() {
  const { trackLoading } = useLoading();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(emptySummary);
  const [actionCenter, setActionCenter] = useState(emptyActionCenter);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [dashboardError, setDashboardError] = useState("");

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoadingDashboard(true);
    setDashboardError("");

    try {
      const [summaryResponse, actionCenterResponse] = await trackLoading(() =>
        Promise.all([getDashboardSummary(), getDashboardActionCenter()])
      );

      setSummary(summaryResponse.data || emptySummary);
      setActionCenter(actionCenterResponse.data || emptyActionCenter);
    } catch (error) {
      setDashboardError(error.message);
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  const stats = [
    {
      id: "total-matches",
      title: "Total Matches",
      value: String(summary.total_matches),
      subtitle: "All of your submitted, confirmed, and disputed match records",
      icon: "TM",
      emphasis: summary.total_matches > 0,
    },
    {
      id: "wins",
      title: "Wins",
      value: String(summary.wins),
      subtitle: "Confirmed wins only, so your record is built on trusted results",
      icon: "WN",
      emphasis: summary.wins > 0,
    },
    {
      id: "pending-matches",
      title: "Pending Matches",
      value: String(summary.pending_matches),
      subtitle: "Matches still waiting for an opponent decision",
      icon: "PM",
      emphasis: summary.pending_matches > 0,
    },
    {
      id: "disputed-matches",
      title: "Disputed Matches",
      value: String(summary.disputed_matches),
      subtitle: "Results that need follow-up before they can be trusted",
      icon: "DM",
      emphasis: summary.disputed_matches > 0,
    },
    {
      id: "actions-required",
      title: "Actions Required",
      value: String(summary.actions_required),
      subtitle: "Reviews currently waiting on your decision",
      icon: "AR",
      emphasis: summary.actions_required > 0,
    },
  ];

  return (
    <DashboardLayout title="Performance Dashboard" description="">
      <section className="stat-grid stat-grid-wide">
        {isLoadingDashboard
          ? stats.map((stat) => (
              <article key={stat.id} className="stat-card">
                <SectionSkeleton lines={3} />
              </article>
            ))
          : stats.map((stat) => (
              <StatCard
                key={stat.id}
                title={stat.title}
                value={stat.value}
                subtitle={stat.subtitle}
                icon={stat.icon}
                emphasis={stat.emphasis}
              />
            ))}
      </section>

      <section className="dashboard-panels">
        <MomentumChart title="Weekly Momentum" subtitle="" data={momentumData} />
        <TopPerformers players={topPerformers} />
      </section>

      <section className="dashboard-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Action Center</p>
            <h2 className="panel-title">Actions</h2>
          </div>
        </div>

        <ErrorState message={dashboardError} onRetry={loadDashboard} retryLabel="Try again" />

        {isLoadingDashboard ? (
          <>
            <div className="action-card-grid">
              <article className="action-card">
                <SectionSkeleton lines={4} />
              </article>
              <article className="action-card">
                <SectionSkeleton lines={4} />
              </article>
              <article className="action-card">
                <SectionSkeleton lines={4} />
              </article>
            </div>

            <div className="dashboard-review-stack">
              <SectionSkeleton lines={4} />
              <SectionSkeleton lines={4} />
            </div>
          </>
        ) : (
          <>
            <div className="action-card-grid">
              {actionCenter.actions.map((card) => (
                <Link
                  key={card.id}
                  className={`action-card action-card-clickable${card.count > 0 ? " action-card-highlight" : ""} action-card-${card.tone}`}
                  to={card.action_path}
                >
                  <div className="action-card-top">
                    <p className="action-card-eyebrow">{card.title}</p>
                    <strong className="action-card-count">{card.count}</strong>
                  </div>
                  <span className="action-card-link">{card.action_label}</span>
                </Link>
              ))}
            </div>

            {actionCenter.items.length ? (
              <div className="dashboard-review-stack">
                {actionCenter.items.map((item) => (
                  <article key={item.id} className="review-item-card">
                    <div className="review-item-copy">
                      <p className="review-item-type">{formatActionType(item.type)}</p>
                      <h3 className="review-item-title">{item.message}</h3>
                      <p className="review-item-time">{formatDate(item.created_at)}</p>
                    </div>
                    <button
                      type="button"
                      className="inline-action-link"
                      onClick={() => navigate(buildActionDestination(item))}
                    >
                      {item.action_label || "Review Now"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="match-empty-state">
                <p className="empty-state-copy">No actions required</p>
              </div>
            )}
          </>
        )}
      </section>
    </DashboardLayout>
  );
}

function buildActionDestination(item) {
  const rawDestination = item?.action_url || item?.action_path || "/dashboard/matches";
  const destination = new URL(rawDestination, window.location.origin);
  const matchId = item?.related_match_id || item?.match_id;

  if (
    (destination.pathname === "/dashboard/matches" ||
      destination.pathname.endsWith("/dashboard/matches")) &&
    matchId &&
    !destination.searchParams.get("matchId")
  ) {
    destination.searchParams.set("matchId", matchId);
  }

  destination.searchParams.set("open", String(Date.now()));

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsedDate);
}

function formatActionType(type) {
  if (type === "match_request") {
    return "Match request";
  }

  if (type === "result_awaiting_confirmation") {
    return "Pending confirmation";
  }

  if (type === "dispute_status") {
    return "Disputed result";
  }

  return "Review item";
}
