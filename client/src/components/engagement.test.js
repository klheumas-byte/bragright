import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCompetitiveMoments,
  buildCompetitivePulse,
  buildPlayerHighlights,
  normalizeEngagementNotifications,
} from "./engagementViewModel.js";

const root = new URL("../", import.meta.url);
const activity = readFileSync(new URL("components/ActivityItem.jsx", root), "utf8");
const cards = readFileSync(new URL("components/EngagementCards.jsx", root), "utf8");
const skeletons = readFileSync(new URL("components/EngagementSkeletons.jsx", root), "utf8");
const dashboard = readFileSync(new URL("pages/Dashboard.jsx", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");

test("activity cards include real actor identity, event presentation, time, status, and contextual action", () => {
  assert.match(activity, /<PlayerIdentity/);
  assert.match(activity, /presentation\.icon/);
  assert.match(activity, /presentation\.title/);
  assert.match(activity, /presentation\.description/);
  assert.match(activity, /<time/);
  assert.match(activity, /presentation\.status/);
  assert.match(activity, /presentation\.destination/);
});

test("existing action-center types become accessible priority notifications", () => {
  const notifications = normalizeEngagementNotifications([
    { id: "1", type: "match_request", message: "Ama challenged you", created_at: "2026-07-19T10:00:00Z", action_path: "/dashboard/matches" },
    { id: "2", type: "result_awaiting_confirmation", message: "A result is ready" },
    { id: "3", type: "dispute_status", message: "A dispute needs review" },
  ]);
  assert.deepEqual(notifications.map((item) => item.title), ["New challenge received", "Result awaiting confirmation", "Dispute update"]);
  assert.deepEqual(notifications.map((item) => item.priority), ["Action required", "Action required", "Important"]);
  assert.equal(notifications[0].actionPath, "/dashboard/matches");
});

test("notification fallbacks remain neutral and never invent social events", () => {
  const [notification] = normalizeEngagementNotifications([{ type: "unknown", message: "Existing update" }]);
  assert.equal(notification.title, "Match update");
  assert.equal(notification.description, "Existing update");
  assert.doesNotMatch(JSON.stringify(notification), /verified|streak|achievement|promotion/i);
});

test("player highlights render only available confirmed values", () => {
  assert.deepEqual(buildPlayerHighlights({}, null), []);
  const highlights = buildPlayerHighlights({ wins: 4, losses: 3, draws: 1, total_matches: 8 }, { rank: 3, points: 21 });
  assert.deepEqual(highlights.map((item) => item.id), ["current-standing", "confirmed-wins", "competitive-activity"]);
  assert.equal(highlights[0].value, "#3");
  assert.match(highlights[0].description, /21 confirmed points/);
});

test("competitive moments use exact current milestones and hide unsupported moments", () => {
  assert.deepEqual(buildCompetitiveMoments({ wins: 0, total_matches: 0 }, null), []);
  const moments = buildCompetitiveMoments({ wins: 1, losses: 99, draws: 0, total_matches: 100 }, { rank: 8 });
  assert.deepEqual(moments.map((item) => item.id), ["first-win", "top-ten", "matches-100"]);
  assert.deepEqual(buildCompetitiveMoments({ wins: 2, losses: 97, draws: 0, total_matches: 99 }, { rank: 11 }), []);
});

test("competitive pulse uses only already-loaded recent matches, activity, and responsibilities", () => {
  const pulse = buildCompetitivePulse({ recentMatches: [{ id: 1 }], recentActivity: [{ id: 2 }, { id: 3 }], actionsRequired: 1 });
  assert.deepEqual(pulse.map((item) => [item.id, item.value]), [["recent-matches", 1], ["recent-events", 2], ["open-actions", 1]]);
  assert.deepEqual(buildCompetitivePulse({}), []);
});

test("dashboard reuses loaded data and does not add notification or trending requests", () => {
  assert.match(dashboard, /normalizeEngagementNotifications\(pendingActions\)/);
  assert.match(dashboard, /buildCompetitivePulse/);
  assert.match(dashboard, /useMemo/);
  assert.doesNotMatch(dashboard, /getDashboardNotifications|getTrending|fetch\(/);
});

test("engagement cards expose labels, timestamps, actions, and polite moment announcements", () => {
  assert.match(cards, /aria-label=\{`\$\{notification\.title\}/);
  assert.match(cards, /<time dateTime=\{timestamp\.dateTime\}/);
  assert.match(cards, /onAction\?\.\(notification\)/);
  assert.match(cards, /aria-live="polite"/);
  assert.match(cards, /EmptyState title="The arena is quiet"/);
});

test("activity, notifications, highlights, pulse, and widgets have dedicated skeleton architecture", () => {
  assert.match(skeletons, /NotificationListSkeleton/);
  assert.match(skeletons, /HighlightGridSkeleton/);
  assert.match(skeletons, /EngagementActivitySkeleton/);
  assert.match(skeletons, /CompetitivePulseSkeleton/);
  assert.match(skeletons, /PlayerIdentitySkeleton/);
});

test("engagement layouts are responsive, theme-aware, accessible, and reduced-motion safe", () => {
  assert.match(css, /\.engagement-notification[\s\S]*?min-width: 0/);
  assert.match(css, /\.engagement-highlight-grid[\s\S]*?grid-template-columns/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?engagement-highlight-grid/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?engagement-notification/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?competitive-moment/);
  assert.match(css, /var\(--surface-interactive\)/);
});
