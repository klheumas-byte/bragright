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
      total_matches: toCount(overview.total_matches),
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
  const stats = [
    stat("matches", "Matches Played", overview.total_matches, "All match workflows", "matches", "primary"),
    stat("wins", "Wins", overview.wins, "Confirmed wins", "trophy", "success"),
    stat("losses", "Losses", overview.losses, "Confirmed losses", "disputes", "danger"),
    stat("draws", "Draws", overview.draws, "Confirmed draws", "balance", "warning"),
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
    stat("matches", "Matches Played", profile.total_matches, "Confirmed matches", "matches", "primary"),
    stat("wins", "Wins", profile.wins, "Confirmed wins", "trophy", "success", profile.wins > 0),
    stat("losses", "Losses", profile.losses, "Confirmed losses", "disputes", "danger"),
    stat("draws", "Draws", profile.draws, "Confirmed draws", "balance", "warning"),
    stat("win-rate", "Win Rate", `${profile.win_rate}%`, "Backend-provided rate", "bolt", "secondary"),
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

function expandResultLabel(label, result) {
  const value = String(label || result || "").toLowerCase();
  if (value === "w" || value === "win") return "Win";
  if (value === "l" || value === "loss") return "Loss";
  if (value === "d" || value === "draw") return "Draw";
  return "";
}

import { getMatchStatusPresentation } from "./matchPresentation.js";
