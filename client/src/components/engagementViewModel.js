const NOTIFICATION_TYPES = Object.freeze({
  match_request: {
    title: "New challenge received",
    icon: "matches",
    tone: "warning",
    priority: "Action required",
  },
  result_awaiting_confirmation: {
    title: "Result awaiting confirmation",
    icon: "activity",
    tone: "warning",
    priority: "Action required",
  },
  dispute_status: {
    title: "Dispute update",
    icon: "disputes",
    tone: "danger",
    priority: "Important",
  },
});

const NOTIFICATION_FALLBACK = Object.freeze({
  title: "Match update",
  icon: "activity",
  tone: "info",
  priority: "Update",
});

export function normalizeEngagementNotifications(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const definition = NOTIFICATION_TYPES[item?.type] || NOTIFICATION_FALLBACK;
    return {
      id: String(item?.id || `notification-${index}`),
      type: String(item?.type || "update"),
      title: definition.title,
      description: cleanText(item?.message) || "A match record needs your attention.",
      timestamp: item?.created_at || null,
      priority: definition.priority,
      tone: definition.tone,
      icon: definition.icon,
      actionLabel: cleanText(item?.action_label) || "Review now",
      actionPath: item?.action_url || item?.action_path || "/dashboard/matches",
      matchId: cleanText(item?.related_match_id || item?.match_id),
    };
  });
}

export function buildPlayerHighlights(summary, ranking) {
  const highlights = [];
  const rank = positiveNumber(ranking?.rank);
  const points = nonNegativeNumber(ranking?.points);
  const matches = confirmedMatchCount(summary);
  const wins = nonNegativeNumber(summary?.wins);

  if (rank != null) {
    highlights.push({
      id: "current-standing",
      label: "Current standing",
      value: `#${rank}`,
      description: points == null ? "Official leaderboard position" : `${formatNumber(points)} confirmed points`,
      icon: "crown",
      tone: rank <= 3 ? "prestige" : "primary",
    });
  }
  if (wins > 0) {
    highlights.push({
      id: "confirmed-wins",
      label: "Confirmed victories",
      value: formatNumber(wins),
      description: wins === 1 ? "Your first confirmed win" : "Wins in your official record",
      icon: "trophy",
      tone: "success",
    });
  }
  if (matches > 0) {
    highlights.push({
      id: "competitive-activity",
      label: "Competitive activity",
      value: formatNumber(matches),
      description: matches === 1 ? "Confirmed match played" : "Confirmed matches played",
      icon: "matches",
      tone: "secondary",
    });
  }
  return highlights.slice(0, 3);
}

export function buildCompetitiveMoments(summary, ranking) {
  const moments = [];
  const wins = nonNegativeNumber(summary?.wins);
  const matches = confirmedMatchCount(summary);
  const rank = positiveNumber(ranking?.rank);

  if (wins === 1) {
    moments.push({ id: "first-win", title: "First win secured", description: "Your first confirmed victory is now part of your record.", icon: "trophy", tone: "success" });
  }
  if (rank != null && rank <= 10) {
    moments.push({ id: "top-ten", title: "Top 10 competitor", description: `You currently hold official rank #${rank}.`, icon: "crown", tone: "prestige" });
  }
  if (matches >= 100 && matches % 100 === 0) {
    moments.push({ id: `matches-${matches}`, title: `${formatNumber(matches)} matches reached`, description: "A confirmed competitive milestone.", icon: "matches", tone: "primary" });
  }
  return moments;
}

export function buildCompetitivePulse({ recentMatches, recentActivity, actionsRequired }) {
  const pulse = [];
  const matches = Array.isArray(recentMatches) ? recentMatches.length : 0;
  const activity = Array.isArray(recentActivity) ? recentActivity.length : 0;
  const actions = nonNegativeNumber(actionsRequired);
  if (matches) pulse.push({ id: "recent-matches", label: "Recent matches", value: matches, icon: "matches", tone: "primary" });
  if (activity) pulse.push({ id: "recent-events", label: "Recent events", value: activity, icon: "activity", tone: "secondary" });
  if (actions) pulse.push({ id: "open-actions", label: "Needs attention", value: actions, icon: "bolt", tone: "warning" });
  return pulse;
}

function cleanText(value) {
  if (value == null || value === "undefined") return "";
  return String(value).trim();
}

function positiveNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function nonNegativeNumber(value) {
  if (value == null || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function confirmedMatchCount(summary) {
  return nonNegativeNumber(summary?.wins) + nonNegativeNumber(summary?.losses) + nonNegativeNumber(summary?.draws);
}
