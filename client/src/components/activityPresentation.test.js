import assert from "node:assert/strict";
import test from "node:test";
import { formatActivityTimestamp, presentActivity } from "./activityPresentation.js";

test("player messages use You and never expose the backend event code", () => {
  const activity = {
    action_type: "result_submitted",
    actor: { display_name: "Ama" },
    details: { player_one_score: 3, player_two_score: 1 },
    related: { available: true, status: "pending_confirmation", path: "/dashboard/matches?matchId=safe", opponent: { display_name: "Michael" } },
  };
  const result = presentActivity(activity);
  assert.equal(result.title, "Result submitted");
  assert.equal(result.description, "You submitted a result (3-1) against Michael.");
  assert.equal(result.destination, "/dashboard/matches?matchId=safe");
  assert.equal(`${result.title} ${result.description}`.includes("result_submitted"), false);
});

test("admin messages identify the actor and safe target", () => {
  const result = presentActivity({ action_type: "admin_role_changed", actor: { display_name: "Admin Ama" }, details: { target: { display_name: "Kojo" }, new_role: "admin" } }, { admin: true });
  assert.equal(result.description, "Admin Ama changed Kojo's role to Admin.");
});

test("unknown and malformed activity fails safely", () => {
  const result = presentActivity({ action_type: "LEGACY_PRIVATE_CODE", actor: null });
  assert.equal(result.title, "Account activity");
  assert.equal(result.description, "You recorded an account event.");
  assert.equal(result.description.includes("LEGACY_PRIVATE_CODE"), false);
});

test("timestamps provide a relative and accessible absolute value", () => {
  const now = Date.parse("2026-07-18T12:00:00.000Z");
  const result = formatActivityTimestamp("2026-07-18T11:00:00.000Z", now);
  assert.equal(result.relative, "1 hour ago");
  assert.match(result.absolute, /Jul/);
  assert.equal(result.dateTime, "2026-07-18T11:00:00.000Z");
  assert.equal(formatActivityTimestamp("not-a-date").relative, "Time unavailable");
});
