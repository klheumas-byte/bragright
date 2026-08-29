import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMatchActionDestination } from "../notifications/notificationEventRegistry.js";
import { getMatchPhaseDestination } from "./matchPhaseNavigation.js";

const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const action = readFileSync(new URL("./MatchAction.jsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../layouts/MatchActionLayout.jsx", import.meta.url), "utf8");
const submit = readFileSync(new URL("./SubmitMatch.jsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./Dashboard.jsx", import.meta.url), "utf8");
const matches = readFileSync(new URL("./MyMatches.jsx", import.meta.url), "utf8");
const navigation = readFileSync(new URL("../components/sidebarNavigation.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const premiumCss = readFileSync(new URL("../styles/premium-theme.css", import.meta.url), "utf8");
const api = readFileSync(new URL("../services/api.js", import.meta.url), "utf8");

test("challenge creation redirects to a focused sent state", () => {
  assert.match(submit, /navigate\(`\/matches\/\$\{createdMatch\.id\}\/sent`/);
  assert.match(app, /\/matches\/:matchId\/sent/);
  assert.match(app, /\/matches\/:matchId\/respond/);
});

test("result entry requires review and confirmation shows the exact score", () => {
  assert.match(action, /Review Result/);
  assert.match(action, /Exact submitted score/);
  assert.match(action, /Is this result correct\?/);
  assert.match(action, /Once confirmed, this result may affect rankings and statistics/);
  assert.match(app, /\/matches\/:matchId\/result\/submit/);
  assert.match(app, /\/matches\/:matchId\/result\/confirm/);
});

test("active matches expose score-preserving quit and mutual restart controls", () => {
  assert.match(action, /forfeitMatch\(matchId/);
  assert.match(action, /The actual score is retained/);
  assert.match(action, /Request restart/);
  assert.match(action, /Agree and restart/);
  assert.match(action, /Decline restart/);
  assert.match(action, /match\.can_respond_restart/);
  assert.match(api, /`\/matches\/\$\{matchId\}\/restart`/);
});

test("accepting a match always advances to the result phase", () => {
  assert.equal(
    getMatchPhaseDestination(
      { id: "match/1", status: "pending_result", can_submit_result: true },
      "respond"
    ),
    "/matches/match%2F1/result/submit"
  );
  assert.equal(
    getMatchPhaseDestination(
      { id: "match-2", status: "pending_result", can_submit_result: true },
      "sent"
    ),
    "/matches/match-2/result/submit"
  );
  assert.equal(
    getMatchPhaseDestination(
      { id: "match-3", status: "match_requested", can_submit_result: false },
      "respond"
    ),
    ""
  );
  assert.match(action, /getMatchPhaseDestination\(loadedMatch, mode\)/);
  assert.match(action, /navigate\(phaseDestination, \{ replace: true \}\)/);
  assert.match(
    action,
    /setMatch\(acceptedMatch\);\s*setSuccess\(""\);\s*setActiveMode\("submit"\);\s*navigate\(phaseDestination, \{ replace: true \}\);/
  );
  assert.match(action, /else if \(activeMode === "submit"\)/);
  assert.match(
    matches,
    /if \(actionType === "accept"\) \{\s*executeAction\(match, actionType\);\s*return;/
  );
  assert.match(
    matches,
    /getMatchPhaseDestination\(acceptedMatch, "respond"\)[\s\S]*?navigate\(phaseDestination, \{ replace: true \}\);/
  );
  assert.match(
    action,
    /useEffect\(\(\) => \{\s*setActiveMode\(mode\);\s*setSuccess\(""\);\s*loadMatch\(\);\s*\}, \[matchId, mode\]\);/
  );
  assert.doesNotMatch(action, /response && alreadyPlayed/);
});

test("lazy match-phase navigation is protected by transitions and Suspense", () => {
  assert.match(main, /<HashRouter future=\{\{ v7_startTransition: true \}\}>/);
  assert.match(
    app,
    /<Suspense fallback=\{<AuthPageSkeleton \/>\}>\s*<Routes>[\s\S]*?\/matches\/:matchId\/result\/submit[\s\S]*?<\/Routes>\s*<\/Suspense>/
  );
});

test("focused layout excludes dashboard analytics and supports safe mobile actions", () => {
  assert.match(layout, /match-action-sticky/);
  assert.doesNotMatch(layout, /Leaderboard|Rivalry|Statistics|Notification/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /@media \(max-width: 320px\)/);
  assert.match(css, /overflow-wrap: anywhere/);
});

test("notification destinations are centralized by action type", () => {
  assert.equal(buildMatchActionDestination("match_request", "abc"), "/matches/abc/respond");
  assert.equal(buildMatchActionDestination("result_required", "abc"), "/matches/abc/result/submit");
  assert.equal(buildMatchActionDestination("result_awaiting_confirmation", "abc"), "/matches/abc/result/confirm");
});

test("dashboard makes the highest-priority match action primary without duplicating it", () => {
  assert.match(dashboard, /primaryAction\.label/);
  assert.match(dashboard, /title="Your match actions"/);
  assert.doesNotMatch(dashboard, /title="What to do next"/);
  assert.match(dashboard, /All matches/);
});

test("match center puts actionable work before statistics and uses focused action routes", () => {
  const actionPosition = matches.indexOf('title="Your match actions"');
  const statisticsPosition = matches.indexOf('title="Match statistics"');
  assert.ok(actionPosition >= 0 && statisticsPosition > actionPosition);
  assert.match(matches, /Accept or decline/);
  assert.match(matches, /Enter result/);
  assert.match(matches, /Review result/);
  assert.match(matches, /navigate\(buildActionDestination\(item\)\)/);
});

test("navigation and responsive styling keep pending match actions prominent", () => {
  assert.ok(navigation.indexOf('id: "matches"') < navigation.indexOf('id: "profile"'));
  assert.match(navigation, /label: "Match Actions"/);
  assert.match(premiumCss, /\.core-match-actions/);
  assert.match(premiumCss, /\.sidebar-link-actionable/);
  assert.match(premiumCss, /max-width: 640px[\s\S]*core-match-action-card > \.ui-button/);
});
