export const EMPTY_DASHBOARD_SUMMARY = Object.freeze({
  total_matches: 0,
  matches_played: 0,
  goals_scored: 0,
  goals_conceded: 0,
  goal_difference: 0,
  clean_sheets: 0,
  win_rate: 0,
  current_form: [],
  statistics_scope_label: "All time",
  wins: 0,
  losses: 0,
  draws: 0,
  pending_matches: 0,
  disputed_matches: 0,
  actions_required: 0,
  recent_summary: [],
});

export const EMPTY_ACTION_CENTER = Object.freeze({
  summary: {
    actions_required: 0,
    match_requests: 0,
    pending_confirmations: 0,
    disputed_matches: 0,
    review_required_items: 0,
  },
  actions: [],
  items: [],
  messages: {
    has_actions: false,
  },
});

export function normalizeDashboardSummary(summary) {
  return {
    total_matches: toNonNegativeNumber(summary?.total_matches),
    matches_played: toNonNegativeNumber(summary?.matches_played),
    goals_scored: toNonNegativeNumber(summary?.goals_scored),
    goals_conceded: toNonNegativeNumber(summary?.goals_conceded),
    goal_difference: toFiniteNumber(summary?.goal_difference),
    clean_sheets: toNonNegativeNumber(summary?.clean_sheets),
    win_rate: toNonNegativeNumber(summary?.win_rate),
    current_form: Array.isArray(summary?.current_form) ? summary.current_form.slice(0, 5) : [],
    statistics_scope_label: summary?.statistics_scope_label || "All time",
    wins: toNonNegativeNumber(summary?.wins),
    losses: toNonNegativeNumber(summary?.losses),
    draws: toNonNegativeNumber(summary?.draws),
    pending_matches: toNonNegativeNumber(summary?.pending_matches),
    disputed_matches: toNonNegativeNumber(summary?.disputed_matches),
    actions_required: toNonNegativeNumber(summary?.actions_required),
    recent_summary: Array.isArray(summary?.recent_summary)
      ? summary.recent_summary.slice(0, 5)
      : [],
  };
}

export function normalizeActionCenter(actionCenter) {
  const items = Array.isArray(actionCenter?.items)
    ? deduplicateById(actionCenter.items)
    : [];

  return {
    summary: {
      actions_required: toNonNegativeNumber(
        actionCenter?.summary?.actions_required
      ),
      match_requests: toNonNegativeNumber(
        actionCenter?.summary?.match_requests
      ),
      pending_confirmations: toNonNegativeNumber(
        actionCenter?.summary?.pending_confirmations
      ),
      disputed_matches: toNonNegativeNumber(
        actionCenter?.summary?.disputed_matches
      ),
      review_required_items: toNonNegativeNumber(
        actionCenter?.summary?.review_required_items
      ),
    },
    actions: Array.isArray(actionCenter?.actions)
      ? deduplicateById(actionCenter.actions)
      : [],
    items,
    messages: {
      has_actions:
        Boolean(actionCenter?.messages?.has_actions) || items.length > 0,
    },
  };
}

export function getPrimaryDashboardAction(actionCenter) {
  const firstItem = actionCenter?.items?.[0];

  if (firstItem) {
    const labels = {
      match_request: "Respond to challenge",
      result_required: "Enter match result",
      result_submission_required: "Enter match result",
      result_awaiting_confirmation: "Review submitted result",
      dispute_requiring_review: "Review disputed match",
    };
    return {
      label: firstItem.action_label || labels[firstItem.type] || "Review match",
      path:
        firstItem.action_url ||
        firstItem.action_path ||
        "/dashboard/matches",
      matchId: firstItem.related_match_id || firstItem.match_id || "",
      isAttentionAction: true,
    };
  }

  return {
    label: "Submit a match",
    path: "/dashboard/submit-match",
    matchId: "",
    isAttentionAction: false,
  };
}

export function buildRankingContext(
  entries,
  currentUserId,
  backendCurrentPlayer = null,
  backendNearbyPlayers = []
) {
  const leaderboard = Array.isArray(entries) ? entries : [];
  const playerIndex = leaderboard.findIndex(
    (entry) => String(entry?.id || "") === String(currentUserId || "")
  );

  if (playerIndex < 0) {
    return {
      player: backendCurrentPlayer || null,
      neighbors: Array.isArray(backendNearbyPlayers)
        ? backendNearbyPlayers
        : [],
    };
  }

  const startIndex = Math.max(0, playerIndex - 1);
  return {
    player: leaderboard[playerIndex],
    neighbors: leaderboard.slice(startIndex, playerIndex + 2),
  };
}

export function getMatchStatusTone(match) {
  return getMatchStatusPresentation(match?.status).tone;
}

export function formatDashboardDate(value, fallback = "Not available") {
  if (!value) {
    return fallback;
  }

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsedDate);
}

export function formatActionType(type) {
  const labels = {
    match_request: "Match request",
    result_awaiting_confirmation: "Pending confirmation",
    dispute_status: "Disputed result",
  };

  return labels[type] || "Review item";
}

function deduplicateById(items) {
  const seenIds = new Set();

  return items.filter((item, index) => {
    const id = String(item?.id || `missing-${index}`);
    if (seenIds.has(id)) {
      return false;
    }
    seenIds.add(id);
    return true;
  });
}

function toNonNegativeNumber(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
}

function toFiniteNumber(value) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}
import { getMatchStatusPresentation } from "./matchPresentation.js";
