import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOwnerCompetitiveStats,
  canChallengePlayer,
  normalizeOwnerMatches,
  normalizeOwnerProfile,
  normalizePublicProfile,
  validateProfileAvatarFile,
} from "./profileViewModel.js";

test("owner profile keeps backend-provided statistics", () => {
  const profile = normalizeOwnerProfile({
    username: "owner",
    overview: { total_matches: 8, wins: 4, losses: 3, draws: 1 },
  });
  assert.deepEqual(
    buildOwnerCompetitiveStats(profile, null)
      .map((stat) => stat.value),
    [8, 4, 3, 1]
  );
});

test("public profile supports missing avatars and long usernames", () => {
  const username = "A-deliberately-long-competitive-player-name";
  const profile = normalizePublicProfile({ id: "two", username });
  assert.equal(profile.username, username);
  assert.equal(profile.profile_image, "");
});

test("empty owner match history remains empty", () => {
  assert.deepEqual(normalizeOwnerMatches(undefined), []);
});

test("owner profile preserves an explicit avatar removal", () => {
  const profile = normalizeOwnerProfile(
    { username: "owner", profile_image: "" },
    { profile_image: "data:image/png;base64,old-avatar" }
  );
  assert.equal(profile.profile_image, "");
});

test("challenge visibility excludes owners and admins", () => {
  const profile = { id: "target" };
  assert.equal(canChallengePlayer({ id: "viewer", role: "player" }, profile), true);
  assert.equal(canChallengePlayer({ id: "target", role: "player" }, profile), false);
  assert.equal(canChallengePlayer({ id: "admin", role: "admin" }, profile), false);
});

test("avatar validation accepts supported small images", () => {
  assert.equal(
    validateProfileAvatarFile({ type: "image/png", size: 100_000 }),
    ""
  );
  assert.match(
    validateProfileAvatarFile({ type: "image/svg+xml", size: 100_000 }),
    /PNG, JPEG, or WebP/
  );
  assert.match(
    validateProfileAvatarFile({ type: "image/jpeg", size: 200_000 }),
    /180 KB/
  );
});
