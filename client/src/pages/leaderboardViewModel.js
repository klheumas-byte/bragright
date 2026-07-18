export const EMPTY_LEADERBOARD_PAGINATION = Object.freeze({
  page: 1,
  limit: 20,
  total: 0,
  pages: 0,
  has_next: false,
  has_previous: false,
});

export function normalizeLeaderboardResponse(data) {
  const source = data || {};
  return {
    entries: normalizeLeaderboardPlayers(source.leaderboard),
    topPlayers: normalizeLeaderboardPlayers(source.top_players),
    currentPlayer: source.current_player
      ? normalizeLeaderboardPlayer(source.current_player)
      : null,
    rankedTotal: toCount(source.ranked_total ?? source.total),
    search: String(source.search || ""),
    pagination: {
      page: toPositive(source.page, 1),
      limit: toPositive(source.limit, 20),
      total: toCount(source.total),
      pages: toCount(source.pages),
      has_next: Boolean(source.has_next),
      has_previous: Boolean(source.has_previous),
    },
  };
}

export function normalizeLeaderboardPlayers(players) {
  return Array.isArray(players)
    ? players.map(normalizeLeaderboardPlayer)
    : [];
}

export function normalizeLeaderboardPlayer(player) {
  return {
    id: String(player?.id || ""),
    username: String(player?.username || "Player"),
    profile_image: player?.profile_image || "",
    rank: toPositive(player?.rank, 1),
    points: toCount(player?.points),
    total_matches: toCount(player?.total_matches),
    wins: toCount(player?.wins),
    losses: toCount(player?.losses),
    draws: toCount(player?.draws),
    win_rate: Number.isFinite(Number(player?.win_rate))
      ? Number(player.win_rate)
      : 0,
  };
}

export function isCurrentLeaderboardPlayer(player, currentUserId) {
  return Boolean(
    player?.id &&
      currentUserId &&
      String(player.id) === String(currentUserId)
  );
}

export function canChallengeLeaderboardPlayer(viewer, player) {
  return Boolean(
    viewer?.id &&
      player?.id &&
      viewer.id !== player.id &&
      viewer.role !== "admin" &&
      viewer.is_admin !== true
  );
}

export function normalizeLeaderboardSearch(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 64);
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function toPositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
