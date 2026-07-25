import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const css = read("index.css");
const dashboard = read("pages/Dashboard.jsx");
const shell = read("layouts/DashboardLayout.jsx");
const matchAction = read("pages/MatchAction.jsx");
const rivalry = read("components/CompetitiveIntelligence.jsx");

test("dashboard follows the action-first attention and performance hierarchy", () => {
  const sections = [
    'title="Your match actions"',
    'title="Competitive Summary"',
    'title="Recent Form"',
    'title="Rivalry"',
    'title="Top Goalscorers"',
    'title="Recent activity"',
  ];
  const positions = sections.map((label) => dashboard.indexOf(label));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(dashboard, /\{primaryAction\.label\}/);
  assert.match(dashboard, />\s*Challenge player\s*</);
  assert.doesNotMatch(dashboard, /title="What to do next"/);
  assert.doesNotMatch(dashboard, /title="Quick actions"/);
});

test("performance and rivalry cards expose the complete supported metric set", () => {
  for (const label of [
    "Career Goals", "Goals Conceded", "Goal Difference", "Wins", "Losses",
    "Draws", "Win Rate", "Clean Sheets", "Current Streak", "Current Rank",
  ]) assert.match(dashboard, new RegExp(`"${label}"`));
  for (const label of ["Total goals", "Goal difference", "Latest result", "Biggest win"]) {
    assert.match(rivalry, new RegExp(label));
  }
});

test("route and action feedback use purposeful motion with reduced-motion support", () => {
  assert.match(shell, /className="route-transition"/);
  assert.match(css, /--motion-route:\s*240ms/);
  assert.match(css, /@keyframes premium-route-enter/);
  assert.match(css, /@keyframes premium-workflow-enter/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*\.route-transition/);
  assert.match(matchAction, /loadingText="Accepting…"/);
  assert.match(matchAction, /loadingText="Submitting…"/);
  assert.match(matchAction, /loadingText="Confirming…"/);
});

test("premium tokens support both themes and intentional small-screen layouts", () => {
  for (const token of [
    "--page-background", "--surface-modal", "--radius-card", "--motion-control",
    "--motion-content", "--motion-route", "--z-sticky-action",
  ]) assert.match(css, new RegExp(token));
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /html\[data-theme\] \.dashboard-shell/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*stat-grid-wide/);
  assert.match(css, /@media \(max-width: 340px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});
