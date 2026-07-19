import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRichMatchViewModel, resolveAvailableActions } from "./richMatchViewModel.js";

const root = new URL("../", import.meta.url);
const cardSource = readFileSync(new URL("components/RichMatchCard.jsx", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");
const myMatches = readFileSync(new URL("pages/MyMatches.jsx", root), "utf8");
const dashboard = readFileSync(new URL("pages/Dashboard.jsx", root), "utf8");
const profileList = readFileSync(new URL("components/ProfileMatchList.jsx", root), "utf8");
const headToHead = readFileSync(new URL("pages/HeadToHead.jsx", root), "utf8");
const adminDisputes = readFileSync(new URL("pages/AdminDisputes.jsx", root), "utf8");

const baseMatch = {
  id: "match-1",
  status: "match_requested",
  player_one: { id: "p1", display_name: "A very long player display name", username: "alpha", rank: 4, points: 920 },
  player_two: { id: "p2", display_name: "Bravo", username: "bravo", rank: 9, points: 740 },
  created_at: "2026-07-18T12:00:00Z",
};

test("pre-result cards use a VS state and never imply a winner", () => {
  const view = createRichMatchViewModel(baseMatch, { currentUserId: "p1" });
  assert.equal(view.scoreState.kind, "versus");
  assert.equal(view.hasScore, false);
  assert.deepEqual(view.winner, { side: "", isDraw: false });
  assert.equal(view.participants.left.perspectiveLabel, "You");
  assert.equal(view.participants.right.perspectiveLabel, "Opponent");
});

test("confirmed cards expose final scores, winners, draws, and viewer-oriented score order", () => {
  const match = { ...baseMatch, status: "confirmed", player_one_score: 3, player_two_score: 7 };
  const view = createRichMatchViewModel(match, { currentUserId: "p2" });
  assert.deepEqual(view.scores, { left: 7, right: 3 });
  assert.equal(view.scoreState.isFinal, true);
  assert.equal(view.winner.side, "left");

  const draw = createRichMatchViewModel({ ...match, player_one_score: 4, player_two_score: 4 });
  assert.equal(draw.winner.isDraw, true);
  assert.equal(draw.winner.side, "");
});

test("submitted and disputed scores remain explicitly non-final", () => {
  const submitted = createRichMatchViewModel({ ...baseMatch, status: "pending_confirmation", player_one_score: 5, player_two_score: 2 });
  const disputed = createRichMatchViewModel({ ...baseMatch, status: "disputed", player_one_score: 5, player_two_score: 2 });
  assert.equal(submitted.scoreState.isFinal, false);
  assert.match(submitted.scoreState.label, /not final/i);
  assert.equal(disputed.scoreState.isFinal, false);
  assert.equal(disputed.isDisputed, true);
  assert.match(disputed.contextMessage, /administrator review/i);
});

test("action availability is derived only from existing server permission flags", () => {
  assert.deepEqual(resolveAvailableActions({ can_accept: true, can_dispute: true, can_cancel: true }), ["accept", "dispute", "cancel"]);
  assert.deepEqual(resolveAvailableActions({ can_accept: false, can_confirm: false, can_rematch: true }), []);
  assert.doesNotMatch(cardSource, /fetch\(|axios|services\/api|can_rematch|share|chat/i);
});

test("missing optional data is omitted while real player identity remains accessible", () => {
  const view = createRichMatchViewModel({ status: "scheduled", player_one_name: "Alpha", player_two_name: "Bravo" });
  assert.equal(view.metadata.length, 0);
  assert.match(view.accessibleLabel, /Alpha and Bravo/);
  assert.equal(view.status.label, "Scheduled");
  assert.doesNotMatch(JSON.stringify(view), /Not available|undefined/);
});

test("the component provides variants, shared identity, truncation, focus, and responsive layouts", () => {
  assert.match(cardSource, /`rich-match-card--\$\{variant\}`/);
  assert.match(cardSource, /<PlayerIdentity/);
  assert.match(cardSource, /aria-label=\{view\.accessibleLabel\}/);
  assert.match(cardSource, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(css, /\.player-identity__name[\s\S]*?text-overflow: ellipsis/);
  assert.match(css, /\.rich-match-card:focus-visible/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.rich-match-card/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.rich-match-card/);
});

test("selected, disputed, winner, status, and skeleton states have distinct semantic treatment", () => {
  assert.match(css, /\.rich-match-card--selected[\s\S]*?var\(--accent-primary\)/);
  assert.match(css, /\.rich-match-card--disputed[\s\S]*?var\(--status-danger\)/);
  assert.match(css, /\.rich-match-participant--winner[\s\S]*?var\(--status-success\)/);
  assert.match(cardSource, /view\.status\.tone/);
  assert.match(cardSource, /RichMatchCardSkeleton/);
  assert.match(cardSource, /variant !== "compact"/);
  assert.match(cardSource, /Review case/);
});

test("priority match surfaces use the shared component with appropriate density", () => {
  assert.match(myMatches, /<RichMatchCard[\s\S]*?variant="full"/);
  assert.match(dashboard, /<RichMatchCard[\s\S]*?variant="compact"/);
  assert.match(profileList, /<RichMatchCard[\s\S]*?variant="compact"/);
  assert.match(headToHead, /<RichMatchCard[\s\S]*?variant="compact"/);
  assert.match(adminDisputes, /<RichMatchCard[\s\S]*?variant="admin"/);
});
