import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPerformanceInsights,
  calculateHeadToHead,
  calculateWinRate,
  createHeadToHeadSummary,
  getNextBestAction,
  getNextCompetitiveGoal,
  getPendingPlayerActions,
  getPerformanceTrend,
  getRankMovement,
  getRecentForm,
  isConfirmedMatch,
} from "./competitiveIntelligenceViewModel.js";

const match = (overrides = {}) => ({ id: "m1", status: "confirmed", result: "win", opponent_name: "Daniel", opponent_id: "p2", confirmed_at: "2026-06-01T10:00:00Z", ...overrides });

test("recent form includes confirmed matches only and sorts newest first", () => {
  const form = getRecentForm([
    match({ id: "old", confirmed_at: "2026-01-01T00:00:00Z" }),
    match({ id: "disputed", status: "disputed" }),
    match({ id: "cancelled", status: "cancelled" }),
    match({ id: "new", result: "loss", confirmed_at: "2026-07-01T00:00:00Z" }),
  ]);
  assert.deepEqual(form.map((item) => item.id), ["new", "old"]);
  assert.equal(isConfirmedMatch({ status: "disputed" }), false);
});

test("win rate protects zero and preserves authoritative rate", () => {
  assert.equal(calculateWinRate({ wins: 0, totalMatches: 0 }), 0);
  assert.equal(calculateWinRate({ wins: 2, totalMatches: 3 }), 66.7);
  assert.equal(calculateWinRate({ wins: 2, totalMatches: 3, authoritativeWinRate: 71.25 }), 71.25);
});

test("pending actions hide completed, unauthorized, and expired items", () => {
  const actions = getPendingPlayerActions([
    { id: "valid", type: "match_request" },
    { id: "result", type: "result_required" },
    { id: "done", completed: true },
    { id: "forbidden", can_act: false },
    { id: "expired", expires_at: "2020-01-01T00:00:00Z" },
  ], new Date("2026-01-01T00:00:00Z").getTime());
  assert.deepEqual(actions.map((item) => item.id), ["valid", "result"]);
});

test("core match actions prioritize confirmation, acceptance, then result entry", () => {
  const actions = getPendingPlayerActions([
    { id: "submit", type: "result_required", created_at: "2026-07-24T12:00:00Z" },
    { id: "accept", type: "match_request", created_at: "2026-07-24T11:00:00Z" },
    { id: "confirm", type: "result_awaiting_confirmation", created_at: "2026-07-24T10:00:00Z" },
  ]);
  assert.deepEqual(actions.map((item) => item.id), ["confirm", "accept", "submit"]);
});

test("next best action follows dispute, confirmation, submission, request priority", () => {
  const selected = getNextBestAction([
    { type: "match_request" },
    { type: "result_awaiting_confirmation" },
    { type: "dispute_requiring_review" },
  ]);
  assert.equal(selected.type, "dispute_requiring_review");
  assert.match(selected.title, /dispute/i);
});

test("next best action falls back to a supported challenge route", () => {
  const selected = getNextBestAction([]);
  assert.equal(selected.actionPath, "/dashboard/submit-match");
});

test("rank movement treats a lower numeric rank as improvement", () => {
  assert.deepEqual(getRankMovement([{ rank: 12 }, { rank: 7 }]), { previous: 12, current: 7, change: 5, direction: "up", summary: "Up 5 positions" });
  assert.equal(getRankMovement([{ rank: 7 }]), null);
});

test("rating trend requires real history", () => {
  assert.equal(getPerformanceTrend([{ rating: 1400 }]), null);
  assert.equal(getPerformanceTrend([{ rating: 1400 }, { rating: 1438 }]).change, 38);
});

test("performance insights derive only from available confirmed data", () => {
  const insights = buildPerformanceInsights({
    matches: [match(), match({ id: "m2", result: "loss" }), match({ id: "pending", status: "pending_result" })],
    summary: { wins: 1, losses: 1, draws: 0 },
    actionSummary: { pending_confirmations: 2 },
  });
  assert.equal(insights.length, 3);
  assert.match(insights[0].text, /1 of your last 2/);
});

test("rivalry needs three confirmed meetings and excludes unresolved matches", () => {
  assert.equal(calculateHeadToHead([match(), match({ id: "m2" })]), null);
  const rivalry = calculateHeadToHead([
    match(), match({ id: "m2", result: "loss" }), match({ id: "m3", result: "draw" }),
    match({ id: "m4", status: "disputed" }),
  ]);
  assert.equal(rivalry.matches, 3);
  assert.deepEqual([rivalry.wins, rivalry.losses, rivalry.draws], [1, 1, 1]);
});

test("head-to-head preserves player orientation and authoritative totals", () => {
  const summary = createHeadToHeadSummary({ player_a: { id: "a", username: "A" }, player_b: { id: "b", username: "B" }, total_matches: 5, player_a_wins: 3, player_b_wins: 1, draws: 1 });
  assert.equal(summary.playerA.id, "a");
  assert.equal(summary.playerAWins, 3);
  assert.equal(summary.playerBWins, 1);
});

test("goals use supported deterministic targets and can hide", () => {
  assert.equal(getNextCompetitiveGoal({ summary: { wins: 0, losses: 0, draws: 0 } }).id, "first-match");
  assert.equal(getNextCompetitiveGoal({ summary: { wins: 2, losses: 1, draws: 0 } }).id, "five-matches");
  assert.equal(getNextCompetitiveGoal({ summary: { wins: 5, losses: 1, draws: 0 }, ranking: { rank: 25 } }).id, "top-20");
  assert.equal(getNextCompetitiveGoal({ summary: { wins: 5, losses: 1, draws: 0 }, ranking: { rank: 10 } }), null);
});
