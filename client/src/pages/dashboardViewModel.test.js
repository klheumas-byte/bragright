import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRankingContext,
  getMatchStatusTone,
  getPrimaryDashboardAction,
  normalizeActionCenter,
  normalizeDashboardSummary,
} from "./dashboardViewModel.js";

test("dashboard summary keeps real recent matches and normalizes invalid counts", () => {
  const recentMatches = [{ id: "match-1" }, { id: "match-2" }];
  const summary = normalizeDashboardSummary({
    total_matches: 4,
    wins: "2",
    losses: -1,
    recent_summary: recentMatches,
  });

  assert.equal(summary.total_matches, 4);
  assert.equal(summary.wins, 2);
  assert.equal(summary.losses, 0);
  assert.deepEqual(summary.recent_summary, recentMatches);
});

test("action center removes duplicate cards and chooses the first responsibility", () => {
  const actionCenter = normalizeActionCenter({
    actions: [{ id: "matches" }, { id: "matches" }],
    items: [
      {
        id: "review-1",
        action_label: "Confirm result",
        action_url: "/dashboard/matches",
        related_match_id: "match-1",
      },
      { id: "review-1" },
    ],
  });

  assert.equal(actionCenter.actions.length, 1);
  assert.equal(actionCenter.items.length, 1);
  assert.deepEqual(getPrimaryDashboardAction(actionCenter), {
    label: "Confirm result",
    path: "/dashboard/matches",
    matchId: "match-1",
    isAttentionAction: true,
  });
});

test("dashboard defaults its primary action to the existing submit-match route", () => {
  assert.equal(
    getPrimaryDashboardAction({ items: [] }).path,
    "/dashboard/submit-match"
  );
});

test("ranking context includes the current player and adjacent competitors", () => {
  const leaderboard = [
    { id: "one", rank: 1 },
    { id: "two", rank: 2 },
    { id: "three", rank: 3 },
    { id: "four", rank: 4 },
  ];

  const context = buildRankingContext(leaderboard, "three");
  assert.equal(context.player.rank, 3);
  assert.deepEqual(
    context.neighbors.map((entry) => entry.id),
    ["two", "three", "four"]
  );
});

test("ranking context stays empty when the authenticated player is absent", () => {
  assert.deepEqual(buildRankingContext([{ id: "another-player" }], "missing"), {
    player: null,
    neighbors: [],
  });
});

test("ranking context uses backend current-player data outside the loaded page", () => {
  const context = buildRankingContext(
    [{ id: "first", rank: 1 }],
    "current",
    { id: "current", rank: 101, points: 4 },
    [
      { id: "above", rank: 100 },
      { id: "current", rank: 101, points: 4 },
      { id: "below", rank: 102 },
    ]
  );
  assert.equal(context.player.rank, 101);
  assert.deepEqual(context.neighbors.map((player) => player.rank), [100, 101, 102]);
});

test("long player names remain intact for responsive presentation", () => {
  const longName = "A-player-name-that-is-deliberately-long-enough-to-wrap";
  const context = buildRankingContext(
    [{ id: "player", username: longName, rank: 1, points: 3 }],
    "player"
  );

  assert.equal(context.player.username, longName);
});

test("match status tones distinguish attention and confirmed states", () => {
  assert.equal(getMatchStatusTone({ status: "disputed" }), "danger");
  assert.equal(
    getMatchStatusTone({ status: "pending_confirmation" }),
    "warning"
  );
  assert.equal(
    getMatchStatusTone({ status: "confirmed", result: "win" }),
    "success"
  );
});
