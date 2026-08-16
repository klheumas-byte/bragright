import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");
const app = source("App.jsx");
const navigation = source("components/sidebarNavigation.js");
const page = source("pages/PhysicalFootball.jsx");
const api = source("services/api.js");
const styles = source("index.css");
const premiumStyles = source("styles/premium-theme.css");

test("Physical Football is a separate authenticated player and admin module", () => {
  assert.match(app, /path="\/physical-football"/);
  assert.match(app, /allowedRoles=\{\["player", "admin", "super_admin"\]\}/);
  assert.equal((navigation.match(/⚽ Physical Football/g) || []).length, 2);
  assert.match(page, /does not change your 🎮 EA FC matches, statistics, or leaderboard/);
  assert.doesNotMatch(page, /submitMatch|match score|leaderboard endpoint/i);
});

test("Sunday session flow exposes real API actions and complete UI states", () => {
  for (const route of ["/physical-football/sessions/current", "/physical-football/sessions", "/availability", "/player-pool", "/teams/shuffle", "/teams/confirm"]) assert.ok(api.includes(route));
  for (const label of ["Open Availability", "Close Availability", "Availability Open", "Availability Closed", "Available", "Not Available", "Random Shuffle", "Shuffle Again", "Manual Adjust", "Save Manual Changes", "Confirm Teams"]) assert.ok(page.includes(label));
  assert.match(page, /Planned distribution:/);
  assert.match(page, /teamDistribution\(session\.selected_player_count, teamCount\)/);
  assert.match(page, /await savePhysicalFootballTeams\(session\.id, draftTeams\);[\s\S]*await confirmPhysicalFootballTeams\(session\.id\)/);
  assert.doesNotMatch(page, /Open Registration|Close Registration|Registration is/);
  assert.match(page, /PhysicalFootballSkeleton/);
  assert.match(page, /Create Sunday Session/);
  assert.match(page, /End time/);
  assert.match(page, /Availability cutoff \(optional\)/);
  assert.match(page, /EmptyState/);
  assert.match(page, /tone: "danger"/);
  assert.match(page, /tone: "success"/);
  assert.match(api, /getPhysicalFootballSessions[\s\S]*\/physical-football\/sessions/);
  assert.match(page, /Completed Sunday Sessions/);
  assert.match(page, /sessions\.filter\(\(item\) => item\.status === "completed"\)/);
  assert.match(page, /nextAvailableSunday\(existingDates\)/);
  assert.match(page, /while \(occupied\.has\(candidate\)\)/);
});

test("Phase 2 exposes coordinator, Winner Stays, and Head-to-Head flows", () => {
  for (const route of ["/coordinator", "/live/config", "/live/start", "/live/matches/", "/live/queue", "/live/head-to-head/score", "/live/end"]) assert.ok(api.includes(route));
  for (const label of ["Match Coordinator", "Team Names", "Winner Stays", "Head-to-Head", "Waiting queue", "Standings", "Confirm Result", "Save Score", "End Winner Stays", "End Head-to-Head"]) assert.ok(page.includes(label));
  assert.match(page, /<h2 className="panel-title">Match Control<\/h2>/);
  assert.match(page, /aria-label="Session format"/);
  assert.match(page, /Needs 3\+ teams/);
  assert.match(page, /Needs 2 teams/);
  assert.match(page, /session\?\.capabilities\?\.can_manage_live/);
  assert.match(page, /const canAssignCoordinator = session\?\.capabilities\?\.can_assign_coordinator[\s\S]*isOrganizer && session\?\.status !== "completed"/);
  assert.match(page, /const canManageLive = session\?\.capabilities\?\.can_manage_live[\s\S]*"match_coordinator"/);
  assert.match(page, /canAssignCoordinator \? <CoordinatorAssignment/);
  assert.doesNotMatch(page, /isOrganizer && session\.capabilities\?\.can_assign_coordinator/);
  assert.match(page, /aria-pressed=\{selected\}/);
  assert.match(page, /state\.waiting_queue/);
  assert.match(page, /Move .* earlier/);
  assert.match(page, /goal_difference/);
});

test("Physical Football layout is responsive and independent from EA FC APIs", () => {
  assert.match(styles, /\.physical-football-layout/);
  assert.match(styles, /\.physical-team-grid/);
  assert.match(styles, /@media \(min-width: 48rem\)/);
  assert.doesNotMatch(api, /\/matches\/.*physical-football/);
});

test("Phase 2 controls are compact and responsive from 320px through desktop", () => {
  assert.match(styles, /\.physical-select-grid[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 22rem\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(min-width: 22\.01rem\) and \(max-width: 47\.99rem\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(min-width: 48rem\)/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
  assert.match(styles, /text-overflow: ellipsis/);
  assert.match(styles, /overflow-x: auto/);
  assert.match(styles, /min-height: 5\.25rem/);
  assert.match(page, /className="physical-football-alert"/);
  assert.match(page, /className="physical-football-modal"/);
  assert.match(premiumStyles, /html\[data-theme\] \.physical-select-card\.is-selected[\s\S]*var\(--primary\)/);
  assert.match(premiumStyles, /\.physical-select-card:disabled:not\(\.is-selected\)[\s\S]*var\(--text-disabled\)/);
  assert.match(premiumStyles, /\.physical-football-alert\.ui-alert--success/);
  assert.match(premiumStyles, /\.physical-football-alert\.ui-alert--danger/);
  assert.match(premiumStyles, /@media \(max-width: 430px\)[\s\S]*\.physical-queue[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(premiumStyles, /max-height: calc\(100dvh[\s\S]*safe-area-inset-bottom/);
});

test("live match centre uses persisted timer events and coordinator review states", () => {
  for (const route of ["/live/goals", "/live/score-correction"]) assert.ok(api.includes(route));
  for (const label of ["Live match", "Report Goal", "Record Goal", "Review Events", "Submit Report", "Confirm", "Reject", "Correct official score"]) assert.ok(page.includes(label));
  assert.match(page, /useLiveElapsed\(match\.started_at \|\| state\.started_at\)/);
  assert.match(page, /item\.match_id === match\.id/);
  assert.match(page, /event\.elapsed_seconds/);
  assert.match(page, /is-\$\{event\.status\}/);
  assert.match(styles, /\.physical-scoreboard--live[\s\S]*clamp\(2\.6rem, 15vw, 4\.5rem\)/);
  assert.match(styles, /\.physical-player-selector[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 22rem\)[\s\S]*\.physical-player-selector[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.physical-goal-modal[\s\S]*100dvh/);
  for (const state of ["pending", "confirmed", "rejected"]) assert.match(styles, new RegExp(`\\.physical-event-status\\.is-${state}`));
});
