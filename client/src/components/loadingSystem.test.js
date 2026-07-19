import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const app = read("App.jsx");
const loadingContext = read("context/LoadingContext.jsx");
const dashboardLayout = read("layouts/DashboardLayout.jsx");
const protectedRoute = read("components/ProtectedRoute.jsx");
const skeletons = read("components/LoadingSkeletons.jsx");
const progress = read("components/RouteProgress.jsx");
const button = read("components/ui/Button.jsx");
const avatar = read("components/ProfileAvatar.jsx");
const submitMatch = read("pages/SubmitMatch.jsx");
const leaderboard = read("pages/Leaderboard.jsx");
const matches = read("pages/MyMatches.jsx");
const activity = read("pages/MyActivity.jsx");
const adminActivity = read("pages/AdminActivity.jsx");
const css = read("index.css");

test("bootstrap authentication uses the branded app loader", () => {
  assert.match(protectedRoute, /isInitializing[\s\S]*<InitialAppLoader/);
  assert.doesNotMatch(dashboardLayout, /InitialAppLoader/);
});

test("normal authenticated navigation keeps one shell around route suspense", () => {
  assert.match(app, /DashboardLayoutProvider[\s\S]*DashboardShell/);
  assert.match(dashboardLayout, /<Sidebar[\s\S]*<DashboardHeader[\s\S]*<Suspense/);
  assert.match(dashboardLayout, /return children;/);
});

test("route progress starts, advances, completes, and has a safety timeout", () => {
  assert.match(progress, /isRouteLoading[\s\S]*routeProgress/);
  assert.match(loadingContext, /setRouteProgress\(0\.08\)/);
  assert.match(loadingContext, /setRouteProgress\(1\)/);
  assert.match(loadingContext, /10000/);
});

test("dashboard, profile, leaderboard, and matches have dedicated page skeletons", () => {
  for (const name of ["DashboardPageSkeleton", "ProfilePageSkeleton", "LeaderboardPageSkeleton", "MyMatchesPageSkeleton"]) {
    assert.match(skeletons, new RegExp(`export function ${name}`));
  }
});

test("match details, submit match, activity, and notifications have dedicated skeletons", () => {
  for (const name of ["MatchDetailsPageSkeleton", "SubmitMatchPageSkeleton", "ActivityPageSkeleton", "NotificationsPageSkeleton"]) {
    assert.match(skeletons, new RegExp(`export function ${name}`));
  }
});

test("admin routes use information-dense dedicated skeletons", () => {
  for (const name of ["AdminDashboardPageSkeleton", "AdminUsersPageSkeleton", "AdminDisputesPageSkeleton", "AdminSettingsPageSkeleton"]) {
    assert.match(skeletons, new RegExp(`export function ${name}`));
  }
  assert.match(skeletons, /SkeletonTableRow/);
});

test("normal route fallbacks are page skeletons rather than the full app loader", () => {
  assert.match(dashboardLayout, /fallback={<RoutePageSkeleton/);
  assert.doesNotMatch(app, /fallback={<InitialAppLoader/);
});

test("background leaderboard and match refreshes preserve existing rows", () => {
  assert.match(leaderboard, /leaderboard-list\$\{isTransitioning[\s\S]*loading-region--refreshing/);
  assert.match(matches, /match-list\$\{isTransitioning[\s\S]*loading-region--refreshing/);
  assert.doesNotMatch(matches, /setListError[\s\S]{0,180}setMatches\(\[\]\)/);
});

test("activity refreshes preserve existing timelines", () => {
  assert.match(activity, /isInitialLoading = isLoading && logs\.length === 0/);
  assert.match(adminActivity, /isInitialLoading = isLoading && logs\.length === 0/);
  assert.match(activity, /Refreshing activity/);
});

test("button loading is isolated and prevents duplicate activation", () => {
  assert.match(button, /disabled \|\| isLoading/);
  assert.match(button, /event\.preventDefault/);
  assert.match(button, /ui-button__loading/);
  assert.match(css, /ui-button\[aria-busy="true"\]/);
});

test("opponent search keeps its query and loaded player cards while refreshing", () => {
  assert.match(submitMatch, /value={opponentSearch}/);
  assert.match(submitMatch, /isLoadingOpponents && !opponents\.length/);
  assert.match(submitMatch, /opponentRequestRef\.current/);
  assert.match(submitMatch, /Searching opponents/);
});

test("avatar loading preserves its box and falls back after an image failure", () => {
  assert.match(avatar, /profile-avatar-placeholder/);
  assert.match(avatar, /onLoad/);
  assert.match(avatar, /onError/);
  assert.match(avatar, /initials[\s\S]*profile-avatar-default-icon/);
});

test("upload state preserves the selected file and exposes processing status", () => {
  assert.match(submitMatch, /match-selected-file/);
  assert.match(submitMatch, /uploadState \? <p role="status">/);
  assert.match(submitMatch, /disabled={isSubmittingResult}/);
});

test("loading, empty, and retryable error states remain distinct", () => {
  assert.match(submitMatch, /OpponentSearchSkeleton/);
  assert.match(submitMatch, /<EmptyState/);
  assert.match(submitMatch, /<ErrorState/);
  assert.match(submitMatch, /retryLabel="Retry opponent search"/);
});

test("loading motion is theme-aware and reduced-motion safe", () => {
  assert.match(css, /html\[data-theme="light"\] \.skeleton/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.skeleton::after/);
  assert.match(css, /#18bfb5/);
  assert.match(css, /#18d5c3/);
});

test("desktop and mobile skeleton layouts avoid fixed overflow", () => {
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*page-skeleton__columns/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*page-skeleton__stats/);
  assert.match(css, /dashboard-sidebar[\s\S]*position: fixed/);
});

test("existing route paths and permission gates remain intact", () => {
  for (const path of ["/dashboard", "/profile", "/leaderboard", "/dashboard/matches", "/dashboard/submit-match", "/activity", "/admin/dashboard", "/admin/users", "/admin/disputes", "/admin/activity", "/admin/settings"]) {
    assert.ok(app.includes(`path="${path}"`), `${path} should remain registered`);
  }
  assert.match(app, /ProtectedRoute requireAdmin/);
});
