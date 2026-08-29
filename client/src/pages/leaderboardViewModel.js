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
    goals_scored: toCount(player?.goals_scored),
    goals_conceded: toCount(player?.goals_conceded),
    goal_difference: toNumber(player?.goal_difference),
    clean_sheets: toCount(player?.clean_sheets),
    average_goals_scored: toNumber(player?.average_goals_scored),
    average_goals_conceded: toNumber(player?.average_goals_conceded),
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

export function normalizeLeaderboardReigns(data) {
  const source = data || {};
  const reigns = Array.isArray(source.reigns) ? source.reigns.map(normalizeReign) : [];
  const totalSecondsByPlayer = Object.fromEntries(
    Object.entries(source.total_seconds_by_player || {}).map(([id, seconds]) => [id, toCount(seconds)])
  );
  const playerNames = new Map(reigns.map((reign) => [reign.playerId, reign.player.username]));
  if (source.current?.player_id) {
    playerNames.set(String(source.current.player_id), String(source.current.player?.username || "Player"));
  }
  return {
    current: source.current ? normalizeReign(source.current) : null,
    reigns,
    totalSecondsByPlayer,
    leaders: Object.entries(totalSecondsByPlayer)
      .map(([playerId, durationSeconds]) => ({
        playerId,
        username: playerNames.get(playerId) || "Player",
        durationSeconds,
      }))
      .sort((left, right) => right.durationSeconds - left.durationSeconds || left.username.localeCompare(right.username)),
  };
}

export function formatReignDuration(value) {
  const seconds = toCount(value);
  const days = Math.floor(seconds / 86400);
  if (days) return `${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.floor(seconds / 3600);
  if (hours) return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

function normalizeReign(reign) {
  return {
    playerId: String(reign?.player_id || ""),
    player: {
      id: String(reign?.player?.id || reign?.player_id || ""),
      username: String(reign?.player?.username || "Player"),
    },
    previousLeader: reign?.previous_leader || null,
    nextLeader: reign?.next_leader || null,
    startedAt: reign?.started_at || null,
    endedAt: reign?.ended_at || null,
    durationSeconds: toCount(reign?.duration_seconds),
  };
}

function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function toPositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
