export const PROFILE_AVATAR_MAX_BYTES = 180_000;
export const PROFILE_AVATAR_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function validateProfileAvatarFile(file) {
  if (!file) {
    return "";
  }
  if (!PROFILE_AVATAR_TYPES.includes(file.type)) {
    return "Choose a PNG, JPEG, or WebP image.";
  }
  if (file.size > PROFILE_AVATAR_MAX_BYTES) {
    return "Profile images must be 180 KB or smaller.";
  }
  return "";
}

export function normalizeOwnerProfile(profile, fallback = {}) {
  const source = profile || {};
  const overview = source.overview || {};
  return {
    id: source.id || fallback.id || "",
    username: source.username || fallback.username || "",
    email: source.email || fallback.email || "",
    profile_image: Object.prototype.hasOwnProperty.call(source, "profile_image")
      ? source.profile_image || ""
      : fallback.profile_image || "",
    created_at: source.created_at || fallback.created_at || null,
    status: source.status || fallback.status || "active",
    role: source.role || fallback.role || "player",
    overview: {
      statistics_available: Object.prototype.hasOwnProperty.call(overview, "goals_scored"),
      total_matches: toCount(overview.total_matches),
      matches_played: toCount(overview.matches_played),
      goals_scored: toCount(overview.goals_scored),
      goals_conceded: toCount(overview.goals_conceded),
      goal_difference: toNumber(overview.goal_difference),
      clean_sheets: toCount(overview.clean_sheets),
      average_goals_scored: toNumber(overview.average_goals_scored),
      average_goals_conceded: toNumber(overview.average_goals_conceded),
      win_rate: toNumber(overview.win_rate),
      current_win_streak: toCount(overview.current_win_streak),
      longest_win_streak: toCount(overview.longest_win_streak),
      statistics_scope_label: overview.statistics_scope_label || "All time",
      wins: toCount(overview.wins),
      losses: toCount(overview.losses),
      draws: toCount(overview.draws),
      pending_matches: toCount(overview.pending_matches),
      disputed_matches: toCount(overview.disputed_matches),
      recent_summary: normalizeOwnerMatches(overview.recent_summary),
    },
  };
}

export function normalizePublicProfile(profile) {
  if (!profile) {
    return null;
  }
  return {
    id: profile.id || "",
    username: profile.username || "Player",
    profile_image: profile.profile_image || "",
    created_at: profile.created_at || null,
    status: profile.status || "active",
    total_matches: toCount(profile.total_matches),
    wins: toCount(profile.wins),
    losses: toCount(profile.losses),
    draws: toCount(profile.draws),
    points: toCount(profile.points),
    rank: toCount(profile.rank) || 1,
    win_rate: Number.isFinite(Number(profile.win_rate))
      ? Number(profile.win_rate)
      : 0,
    goals_scored: toCount(profile.goals_scored ?? profile.statistics?.goals_scored),
    goals_conceded: toCount(profile.goals_conceded ?? profile.statistics?.goals_conceded),
    goal_difference: toNumber(profile.goal_difference ?? profile.statistics?.goal_difference),
    clean_sheets: toCount(profile.clean_sheets ?? profile.statistics?.clean_sheets),
    average_goals_scored: toNumber(profile.average_goals_scored ?? profile.statistics?.average_goals_scored),
    average_goals_conceded: toNumber(profile.average_goals_conceded ?? profile.statistics?.average_goals_conceded),
    current_win_streak: toCount(profile.current_win_streak ?? profile.statistics?.current_win_streak),
    longest_win_streak: toCount(profile.longest_win_streak ?? profile.statistics?.longest_win_streak),
    statistics_scope_label: profile.statistics?.scope_label || "All time",
    recent_confirmed_matches: normalizePublicMatches(
      profile.recent_confirmed_matches
    ),
  };
}

export function normalizeOwnerMatches(matches) {
  return Array.isArray(matches)
    ? matches.map((match) => ({
        id: match?.id || "",
        opponentId: match?.opponent?.id || "",
        opponentName: match?.opponent?.username || "Unknown opponent",
        playerScore: match?.player_score ?? "—",
        opponentScore: match?.opponent_score ?? "—",
        result: match?.result || "pending",
        resultLabel:
          match?.status === "confirmed"
            ? expandResultLabel(match?.result_label, match?.result)
            : "",
        status: match?.status || "pending_result",
        statusLabel:
          getMatchStatusPresentation(match?.status).label,
        playedAt: match?.played_at || match?.created_at || null,
        detailPath: match?.id
          ? `/dashboard/matches?matchId=${encodeURIComponent(match.id)}`
          : "/dashboard/matches",
      }))
    : [];
}

export function normalizePublicMatches(matches) {
  return Array.isArray(matches)
    ? matches.map((match) => ({
        id: match?.match_id || "",
        opponentId: match?.opponent_id || "",
        opponentName: match?.opponent_name || "Unknown opponent",
        playerScore: match?.player_score ?? "—",
        opponentScore: match?.opponent_score ?? "—",
        result: match?.result || "draw",
        resultLabel: expandResultLabel("", match?.result),
        status: "confirmed",
        statusLabel: "Confirmed",
        playedAt: match?.confirmed_at || null,
        detailPath: "",
      }))
    : [];
}

export function buildOwnerCompetitiveStats(profile, ranking) {
  const overview = profile?.overview || {};
  if (!overview.statistics_available) {
    const legacyStats = [
      stat("matches", "Matches Played", overview.total_matches, "All match workflows", "matches", "primary"),
      stat("wins", "Wins", overview.wins, "Confirmed wins", "trophy", "success"),
      stat("losses", "Losses", overview.losses, "Confirmed losses", "disputes", "danger"),
      stat("draws", "Draws", overview.draws, "Confirmed draws", "balance", "warning"),
    ];
    if (ranking) {
      legacyStats.push(
        stat("rank", "Current Rank", `#${ranking.rank}`, "Confirmed leaderboard position", "crown", "primary", true),
        stat("points", "Points", ranking.points, "Confirmed leaderboard points", "bolt", "secondary")
      );
    }
    return legacyStats;
  }
  const stats = [
    stat("goals", "Total Goals", overview.goals_scored, "Career goals · confirmed results", "bolt", "primary", true),
    stat("wins", "Wins", overview.wins, "All-time confirmed wins", "trophy", "success"),
    stat("goal-difference", "Goal Difference", signed(overview.goal_difference), "All-time confirmed results", "balance", overview.goal_difference >= 0 ? "success" : "danger"),
    stat("win-rate", "Win Rate", `${overview.win_rate}%`, "All-time confirmed results", "crown", "primary"),
    stat("conceded", "Goals Conceded", overview.goals_conceded, "Career goals conceded", "disputes", "danger"),
    stat("matches", "Matches Played", overview.matches_played, "Eligible confirmed matches", "matches", "secondary"),
  ];
  if (ranking) {
    stats.push(
      stat("rank", "Current Rank", `#${ranking.rank}`, "Confirmed leaderboard position", "crown", "primary", true),
      stat("points", "Points", ranking.points, "Confirmed leaderboard points", "bolt", "secondary")
    );
  }
  return stats;
}

export function buildPublicCompetitiveStats(profile) {
  return [
    stat("goals", "Total Goals", profile.goals_scored, "Career goals · confirmed results", "bolt", "primary", true),
    stat("wins", "Wins", profile.wins, "All-time confirmed wins", "trophy", "success", profile.wins > 0),
    stat("goal-difference", "Goal Difference", signed(profile.goal_difference), "All-time confirmed results", "balance", profile.goal_difference >= 0 ? "success" : "danger"),
    stat("win-rate", "Win Rate", `${profile.win_rate}%`, "All-time confirmed results", "crown", "primary"),
    stat("conceded", "Goals Conceded", profile.goals_conceded, "Career goals conceded", "disputes", "danger"),
    stat("clean-sheets", "Clean Sheets", profile.clean_sheets, "All-time confirmed results", "balance", "success"),
    stat("rank", "Current Rank", `#${profile.rank}`, `${profile.points} points`, "crown", "primary", true),
  ];
}

export function canChallengePlayer(viewer, profile) {
  return Boolean(
    viewer?.id &&
      profile?.id &&
      viewer.id !== profile.id &&
      viewer.role !== "admin" &&
      viewer.is_admin !== true
  );
}

export function getProfileMatchTone(match, { statusOnly = false } = {}) {
  const status = String(match?.status || "").toLowerCase();
  const result = String(match?.result || "").toLowerCase();
  if (status !== "confirmed") {
    return getMatchStatusPresentation(status).tone;
  }
  if (statusOnly) {
    return getMatchStatusPresentation(status).tone;
  }
  if (result === "win") {
    return "success";
  }
  if (result === "loss") {
    return "danger";
  }
  return "neutral";
}

export function formatProfileDate(value, fallback = "Not available") {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

function stat(id, title, value, subtitle, icon, tone = "primary", emphasis = false) {
  return { id, title, value: value ?? 0, subtitle, icon, tone, emphasis };
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function signed(value) {
  const number = toNumber(value);
  return number > 0 ? `+${number}` : String(number);
}

function expandResultLabel(label, result) {
  const value = String(label || result || "").toLowerCase();
  if (value === "w" || value === "win") return "Win";
  if (value === "l" || value === "loss") return "Loss";
  if (value === "d" || value === "draw") return "Draw";
  return "";
}

import { getMatchStatusPresentation } from "./matchPresentation.js";
