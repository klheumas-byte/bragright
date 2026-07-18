import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMatchTimeline,
  getMatchNextStep,
  getMatchStatusPresentation,
  validateMatchScores,
  validateProofFile,
} from "./matchPresentation.js";

test("official backend statuses map to consistent human-readable presentation", () => {
  assert.equal(getMatchStatusPresentation("pending_confirmation").label, "Awaiting confirmation");
  assert.equal(getMatchStatusPresentation("confirmed").tone, "success");
  assert.equal(getMatchStatusPresentation("future_state").label, "Status unavailable");
});

test("next-step presentation relies on backend action flags", () => {
  assert.equal(getMatchNextStep({ can_accept: true }), "Accept or decline this request");
  assert.equal(getMatchNextStep({ can_confirm: true }), "Confirm or dispute the submitted result");
  assert.equal(getMatchNextStep({ can_submit_result: true }), "Submit the match result");
});

test("score validation rejects missing, fractional, and negative scores", () => {
  assert.match(validateMatchScores("", "1"), /required/i);
  assert.match(validateMatchScores("1.5", "1"), /whole/i);
  assert.match(validateMatchScores("-1", "1"), /negative/i);
  assert.equal(validateMatchScores("2", "1"), "");
});

test("proof validation accepts supported images and rejects invalid files", () => {
  assert.equal(validateProofFile({ type: "image/png", size: 12 }), "");
  assert.match(validateProofFile({ type: "text/plain", size: 12 }), /PNG/i);
  assert.match(validateProofFile({ type: "image/png", size: 0 }), /empty/i);
});

test("timeline uses only available backend timestamps in chronological order", () => {
  const timeline = buildMatchTimeline({
    created_at: "2026-01-01T10:00:00Z",
    result_submitted_at: "2026-01-01T12:00:00Z",
    accepted_at: "2026-01-01T11:00:00Z",
  });
  assert.deepEqual(timeline.map((item) => item.id), ["created", "accepted", "submitted"]);
});
