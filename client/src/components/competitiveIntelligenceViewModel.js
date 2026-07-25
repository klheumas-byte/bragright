const FINAL_STATUS = "confirmed";
const RIVALRY_MINIMUM = 3;

// Presentation-only analytics. Authoritative totals and rates always win when supplied.
export function calculateWinRate({ wins, totalMatches, authoritativeWinRate } = {}) {
  const authoritative = finiteNumber(authoritativeWinRate);
  if (authoritative != null) return Math.max(0, Math.min(100, authoritative));
  const total = nonNegative(totalMatches);
  if (!total) return 0;
  return Math.round((nonNegative(wins) / total) * 1000) / 10;
}

export function getRecentForm(matches, limit = 5) {
  if (!Array.isArray(matches)) return [];
  return matches
    .filter(isConfirmedMatch)
    .map(normalizeFormItem)
    .filter((item) => item.result)
    .sort((left, right) => dateValue(right.playedAt) - dateValue(left.playedAt))
    .slice(0, Math.max(0, limit));
}

export function getPendingPlayerActions(items, now = Date.now()) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => {
    if (!["match_request", "result_required", "result_submission_required", "result_awaiting_confirmation", "dispute_requiring_review"].includes(item?.type)) return false;
    if (!item || item.completed === true || item.is_completed === true || item.can_act === false) return false;
    const status = clean(item.status).toLowerCase();
    if (["completed", "confirmed", "cancelled", "expired", "resolved"].includes(status)) return false;
    const expiry = dateValue(item.expires_at || item.deadline);
    return !expiry || expiry > now;
  }).sort(compareMatchActionPriority);
}

export function getNextBestAction(items) {
  const actions = getPendingPlayerActions(items);
  const selected = actions[0];
  if (!selected) {
    return {
      type: "recommended_competitive_action",
      title: "Challenge your next opponent",
      description: "You have no unresolved competitive actions.",
      actionLabel: "Start a match",
      actionPath: "/dashboard/submit-match",
      tone: "primary",
    };
  }
  const definitions = {
    dispute_status: ["Review your dispute update", "A disputed match needs your attention.", "danger"],
    dispute_requiring_review: ["Review the disputed match", "A disputed match requires an administrator decision.", "danger"],
    dispute_response_required: ["Respond to the dispute", "A disputed match requires your response.", "danger"],
    result_awaiting_confirmation: ["Confirm your latest result", "Your opponent submitted a result that needs review.", "warning"],
    result_required: ["Enter your match result", "An accepted match is waiting for its score.", "warning"],
    result_submission_required: ["Submit your match result", "An accepted match is waiting for its result.", "warning"],
    match_request: ["Respond to a new challenge", "Accept or decline this match request.", "warning"],
  };
  const [title, fallback, tone] = definitions[selected.type] || ["Review your match", "A match item needs your attention.", "warning"];
  return {
    type: selected.type,
    title,
    description: clean(selected.message) || fallback,
    actionLabel: clean(selected.action_label) || "Review now",
    actionPath: selected.action_url || selected.action_path || "/dashboard/matches",
    matchId: clean(selected.related_match_id || selected.match_id),
    tone,
  };
}

function compareMatchActionPriority(left, right) {
  const priorities = {
    dispute_requiring_review: 1,
    result_awaiting_confirmation: 2,
    match_request: 3,
    result_required: 4,
    result_submission_required: 4,
  };
  const priorityDifference =
    (priorities[left?.type] || 50) - (priorities[right?.type] || 50);
  if (priorityDifference) return priorityDifference;
  return dateValue(right?.created_at) - dateValue(left?.created_at);
}

export function buildPerformanceInsights({ matches, summary, actionSummary } = {}) {
  const form = getRecentForm(matches, 5);
  const insights = [];
  if (form.length) {
    const wins = form.filter((item) => item.result === "win").length;
    insights.push({ id: "recent-record", text: `You won ${wins} of your last ${form.length} completed ${form.length === 1 ? "match" : "matches"}.`, path: "/dashboard/matches" });
  }
  const confirmedTotal = nonNegative(summary?.wins) + nonNegative(summary?.losses) + nonNegative(summary?.draws);
  if (confirmedTotal) {
    const rate = calculateWinRate({ wins: summary?.wins, totalMatches: confirmedTotal, authoritativeWinRate: summary?.win_rate });
    insights.push({ id: "win-rate", text: `Your confirmed win rate is ${formatCompetitiveMetric(rate, { suffix: "%" })}.`, path: "/profile" });
  }
  const confirmations = nonNegative(actionSummary?.pending_confirmations);
  if (confirmations) insights.push({ id: "confirmations", text: `You have ${confirmations} ${confirmations === 1 ? "result" : "results"} awaiting confirmation.`, path: "/dashboard/matches" });
  return insights.slice(0, 3);
}

export function getNextCompetitiveGoal({ summary, ranking, actions } = {}) {
  const pending = getPendingPlayerActions(actions);
  if (pending.length) return { id: "clear-actions", title: "Clear pending match actions", description: "Personal target", current: 0, target: pending.length, remaining: pending.length, actionLabel: "Review actions", actionPath: "/dashboard/matches" };
  const confirmed = nonNegative(summary?.wins) + nonNegative(summary?.losses) + nonNegative(summary?.draws);
  if (!confirmed) return { id: "first-match", title: "Complete your first match", description: "Personal target", current: 0, target: 1, remaining: 1, actionLabel: "Start a match", actionPath: "/dashboard/submit-match" };
  if (confirmed < 5) return { id: "five-matches", title: "Complete 5 matches", description: "Personal target", current: confirmed, target: 5, remaining: 5 - confirmed, actionLabel: "Start a match", actionPath: "/dashboard/submit-match" };
  const rank = positiveNumber(ranking?.rank);
  if (rank && rank > 20) return { id: "top-20", title: "Reach the Top 20", description: "Personal target", current: 0, target: rank - 20, remaining: rank - 20, progressLabel: `${rank - 20} positions remaining`, actionLabel: "View leaderboard", actionPath: "/leaderboard" };
  return null;
}

export function getRankMovement(history) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const previous = positiveNumber(history[history.length - 2]?.rank ?? history[history.length - 2]);
  const current = positiveNumber(history[history.length - 1]?.rank ?? history[history.length - 1]);
  if (!previous || !current) return null;
  const change = previous - current;
  return { previous, current, change, direction: change > 0 ? "up" : change < 0 ? "down" : "unchanged", summary: change > 0 ? `Up ${change} positions` : change < 0 ? `Down ${Math.abs(change)} positions` : "No rank change" };
}

export function getPerformanceTrend(history, field = "rating") {
  if (!Array.isArray(history) || history.length < 2) return null;
  const points = history.map((item) => ({ value: finiteNumber(item?.[field] ?? item), at: item?.at || item?.created_at || null })).filter((item) => item.value != null);
  if (points.length < 2) return null;
  return { points, current: points.at(-1).value, previous: points.at(-2).value, change: points.at(-1).value - points.at(-2).value };
}

export function calculateHeadToHead(matches, { minimum = RIVALRY_MINIMUM } = {}) {
  if (!Array.isArray(matches)) return null;
  const groups = new Map();
  getRecentForm(matches, Number.MAX_SAFE_INTEGER).forEach((match) => {
    const key = clean(match.opponentId || match.opponentName).toLowerCase();
    if (!key || key === "unknown opponent") return;
    const record = groups.get(key) || {
      opponentId: match.opponentId,
      opponentName: match.opponentName,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      biggestWin: null,
      latest: null,
    };
    record.matches += 1;
    if (match.result === "win") record.wins += 1;
    else if (match.result === "loss") record.losses += 1;
    else if (match.result === "draw") record.draws += 1;
    const score = parseScoreLine(match.score);
    if (score) {
      record.goalsFor += score.for;
      record.goalsAgainst += score.against;
      const margin = score.for - score.against;
      if (match.result === "win" && (!record.biggestWin || margin > record.biggestWin.margin)) {
        record.biggestWin = { score: match.score, margin };
      }
    }
    if (!record.latest || dateValue(match.playedAt) > dateValue(record.latest.playedAt)) record.latest = match;
    groups.set(key, record);
  });
  const rival = [...groups.values()].filter((item) => item.matches >= minimum).sort((a, b) => b.matches - a.matches || Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses))[0];
  return rival ? {
    ...rival,
    totalGoals: rival.goalsFor + rival.goalsAgainst,
    goalDifference: rival.goalsFor - rival.goalsAgainst,
    latestResult: rival.latest?.score || rival.latest?.resultLabel || "",
    definition: `Most-played opponent across at least ${minimum} confirmed matches.`,
  } : null;
}

export function createHeadToHeadSummary(comparison) {
  if (!comparison?.player_a || !comparison?.player_b) return null;
  return {
    playerA: comparison.player_a,
    playerB: comparison.player_b,
    totalMatches: nonNegative(comparison.total_matches),
    playerAWins: nonNegative(comparison.player_a_wins),
    playerBWins: nonNegative(comparison.player_b_wins),
    draws: nonNegative(comparison.draws),
    latestResult: comparison.most_recent_result?.result_label || comparison.recent_matches?.[0]?.result_label || "",
  };
}

export function formatCompetitiveMetric(value, { suffix = "", fallback = "Not available" } = {}) {
  const number = finiteNumber(value);
  return number == null ? fallback : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number)}${suffix}`;
}

export function isConfirmedMatch(match) {
  return clean(match?.status || match?.match_status).toLowerCase() === FINAL_STATUS;
}

function normalizeFormItem(match) {
  const rawResult = clean(match.result || match.result_label).toLowerCase();
  const result = rawResult === "w" || rawResult === "win" ? "win" : rawResult === "l" || rawResult === "loss" ? "loss" : rawResult === "d" || rawResult === "draw" ? "draw" : "";
  const opponent = match.opponent || {};
  return {
    id: clean(match.id || match.match_id), result,
    resultLabel: result === "win" ? "Win" : result === "loss" ? "Loss" : result === "draw" ? "Draw" : "",
    opponentId: clean(match.opponentId || match.opponent_id || opponent.id),
    opponentName: clean(match.opponentName || match.opponent_name || opponent.username) || "Unknown opponent",
    score: clean(match.score_line) || (isScoreValue(match.playerScore) && isScoreValue(match.opponentScore) ? `${match.playerScore}–${match.opponentScore}` : ""),
    playedAt: match.playedAt || match.confirmed_at || match.played_at || match.created_at || null,
    matchType: clean(match.match_type || match.game),
    detailPath: match.detailPath || (match.id ? `/dashboard/matches?matchId=${encodeURIComponent(match.id)}` : ""),
  };
}

function parseScoreLine(value) {
  const match = clean(value).match(/^(\d+)\s*[–-]\s*(\d+)$/);
  return match ? { for: Number(match[1]), against: Number(match[2]) } : null;
}

function clean(value) { return value == null || value === "undefined" ? "" : String(value).trim(); }
function nonNegative(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function positiveNumber(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function finiteNumber(value) { if (value == null || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function dateValue(value) { const date = value ? new Date(value) : null; return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0; }
function isScoreValue(value) { return value != null && value !== "" && Number.isFinite(Number(value)); }
