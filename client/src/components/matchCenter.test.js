import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMatchCenterViewModel, createRivalryView } from "./matchCenterViewModel.js";

const root = new URL("../", import.meta.url);
const centerSource = readFileSync(new URL("components/MatchCenter.jsx", root), "utf8");
const skeletonSource = readFileSync(new URL("components/MatchSkeletons.jsx", root), "utf8");
const myMatchesSource = readFileSync(new URL("pages/MyMatches.jsx", root), "utf8");
const proofSource = readFileSync(new URL("components/ProtectedProofImage.jsx", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");

const baseMatch = {
  id: "match-1",
  status: "pending_confirmation",
  player_one: { id: "p1", username: "Alpha", profile_image: "/alpha.png" },
  player_two: { id: "p2", username: "Bravo", profile_image: "/bravo.png" },
  player_one_score: 4,
  player_two_score: 2,
  created_at: "2026-07-18T10:00:00Z",
  accepted_at: "2026-07-18T10:15:00Z",
  result_submitted_at: "2026-07-18T11:00:00Z",
  proof_image_url: "/matches/proof.png",
  can_confirm: true,
  can_dispute: true,
};

test("hero uses real participants, centralized status, and non-final submitted scores", () => {
  const view = createMatchCenterViewModel(baseMatch, { currentUserId: "p1" });
  assert.equal(view.participants.left.name, "Alpha");
  assert.equal(view.participants.right.name, "Bravo");
  assert.equal(view.status.label, "Awaiting confirmation");
  assert.equal(view.scoreState.isFinal, false);
  assert.match(centerSource, /MatchCenterHero/);
  assert.match(centerSource, /aria-label={`Match status:/);
  assert.match(centerSource, /view\.winner\.isDraw[\s\S]*?>Draw</);
});

test("timeline and information include only timestamps supplied by the backend", () => {
  const view = createMatchCenterViewModel(baseMatch);
  assert.deepEqual(view.timeline.map((item) => item.id), ["created", "accepted", "submitted"]);
  assert.deepEqual(view.information.map((item) => item.id), ["created", "accepted", "submitted", "evidence"]);
  assert.doesNotMatch(JSON.stringify(view), /scheduled_at|tournament|venue|division|rating/);
});

test("comparison and related matches are derived from the existing head-to-head response", () => {
  const rivalry = createRivalryView({
    player_a: { id: "p1" },
    player_b: { id: "p2" },
    total_matches: 2,
    player_a_wins: 1,
    player_b_wins: 1,
    player_a_points: 7,
    player_b_points: 6,
    recent_matches: [{ match_id: "older-match", player_a_score: 3, player_b_score: 2 }],
  }, [{ id: "p1", name: "Alpha" }, { id: "p2", name: "Bravo" }]);
  assert.equal(rivalry.participants[0].rivalryWins, 1);
  assert.equal(rivalry.participants[1].rivalryPoints, 6);
  assert.equal(rivalry.recentMatches.length, 1);
});

test("evidence provides protected view, retry, and download controls with an empty state", () => {
  assert.match(centerSource, /Match evidence gallery/);
  assert.match(centerSource, /No evidence attached/);
  assert.match(proofSource, /Retry proof/);
  assert.match(proofSource, /download="bragright-match-evidence"/);
});

test("actions remain gated by authoritative permission flags", () => {
  assert.match(myMatchesSource, /hasAvailableMatchActions\(selectedMatch\)/);
  for (const flag of ["can_accept", "can_decline", "can_submit_result", "can_confirm", "can_dispute", "can_cancel"]) {
    assert.match(myMatchesSource, new RegExp(`match\\?\\.${flag}`));
  }
  assert.doesNotMatch(centerSource, /acceptMatch|confirmMatch|disputeMatch|submitMatchResult|can_rematch/);
});

test("loading state mirrors hero, timeline, comparison, metadata, evidence, actions, and statistics", () => {
  for (const section of ["hero", "timeline", "comparison", "metadata", "evidence", "actions", "statistics"]) {
    assert.match(skeletonSource, new RegExp(`match-center-skeleton__${section}`));
  }
  assert.match(skeletonSource, /aria-busy="true"/);
});

test("Match Center is responsive and accessible without horizontal overflow", () => {
  assert.match(centerSource, /aria-label="Premium Match Center"/);
  assert.match(centerSource, /aria-labelledby/);
  assert.match(centerSource, /<ol|<MatchTimeline/);
  assert.match(css, /\.match-center[\s\S]*?min-width: 0/);
  assert.match(css, /@media \(max-width: 1050px\)[\s\S]*?\.match-center__primary-grid/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.match-center__battle/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?\.match-center__battle/);
  assert.match(css, /\.match-center__related-match:focus-visible/);
});
