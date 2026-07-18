import assert from "node:assert/strict";
import test from "node:test";
import {
  canChallengeLeaderboardPlayer,
  isCurrentLeaderboardPlayer,
  normalizeLeaderboardResponse,
  normalizeLeaderboardSearch,
} from "./leaderboardViewModel.js";

test("leaderboard normalization preserves official backend order and absolute ranks", () => {
  const result = normalizeLeaderboardResponse({
    leaderboard: [
      { id: "second-page-one", rank: 21, points: 9 },
      { id: "second-page-two", rank: 22, points: 8 },
    ],
    page: 2,
    limit: 20,
    total: 45,
    pages: 3,
  });
  assert.deepEqual(result.entries.map((player) => player.rank), [21, 22]);
  assert.equal(result.pagination.page, 2);
});

test("current player context is normalized separately without duplicating rows", () => {
  const result = normalizeLeaderboardResponse({
    leaderboard: [{ id: "other", rank: 1 }],
    current_player: { id: "current", rank: 37, points: 3 },
  });
  assert.equal(result.currentPlayer.rank, 37);
  assert.equal(result.entries.some((player) => player.id === "current"), false);
  assert.equal(isCurrentLeaderboardPlayer(result.currentPlayer, "current"), true);
});

test("search is trimmed, normalized, and bounded", () => {
  assert.equal(normalizeLeaderboardSearch("  Maya    Chen  "), "Maya Chen");
  assert.equal(normalizeLeaderboardSearch("x".repeat(80)).length, 64);
});

test("players cannot challenge themselves and admins cannot challenge", () => {
  const player = { id: "target" };
  assert.equal(canChallengeLeaderboardPlayer({ id: "target", role: "player" }, player), false);
  assert.equal(canChallengeLeaderboardPlayer({ id: "viewer", role: "admin" }, player), false);
  assert.equal(canChallengeLeaderboardPlayer({ id: "viewer", role: "player" }, player), true);
});

test("fewer than three top players remain valid", () => {
  const result = normalizeLeaderboardResponse({
    top_players: [{ id: "only", rank: 1 }],
  });
  assert.equal(result.topPlayers.length, 1);
});
