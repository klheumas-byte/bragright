import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  formatPlayerPoints,
  formatPlayerRank,
  getIdentityBadges,
  getPlayerDisplayName,
  normalizePlayerIdentity,
} from "./playerIdentityViewModel.js";

const root = new URL("../", import.meta.url);
const component = readFileSync(new URL("components/PlayerIdentity.jsx", root), "utf8");
const avatar = readFileSync(new URL("components/ProfileAvatar.jsx", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");

test("identity naming prefers display name, normalizes username, and never uses public email", () => {
  const player = { display_name: "  Ama Ösei  ", username: "@ama", email: "private@example.com" };
  assert.equal(getPlayerDisplayName(player), "Ama Ösei");
  assert.deepEqual(normalizePlayerIdentity(player), {
    id: "",
    displayName: "Ama Ösei",
    username: "ama",
    avatar: "",
    rank: null,
    points: null,
    status: "",
    role: "",
    email: "",
    memberSince: null,
    variant: "compact",
    isCurrent: false,
    isWinner: false,
    unavailable: false,
    badgeLimit: 2,
  });
  assert.equal(getPlayerDisplayName({ email: "private@example.com" }), "Player");
  assert.doesNotMatch(JSON.stringify(normalizePlayerIdentity(player)), /private@example/);
});

test("missing and malformed names use respectful fallbacks without undefined text", () => {
  assert.equal(getPlayerDisplayName({ display_name: "undefined", username: null }), "Player");
  assert.equal(normalizePlayerIdentity({ available: false }).unavailable, true);
  assert.doesNotMatch(JSON.stringify(normalizePlayerIdentity({})), /undefined/);
});

test("admin identity can include permitted private metadata without changing public variants", () => {
  const source = { username: "moderated-player", email: "player@example.com", role: "player", status: "disabled" };
  assert.equal(normalizePlayerIdentity(source, { variant: "admin" }).email, "player@example.com");
  assert.equal(normalizePlayerIdentity(source, { variant: "full" }).email, "");
  assert.deepEqual(getIdentityBadges(normalizePlayerIdentity(source, { variant: "admin" })).map((badge) => badge.id), ["status", "role"]);
});

test("rank and points use existing terminology and omit invalid values", () => {
  assert.equal(formatPlayerRank(12), "Rank #12");
  assert.equal(formatPlayerRank(0), "");
  assert.equal(formatPlayerRank(null, { confirmedUnranked: true }), "Unranked");
  assert.equal(formatPlayerPoints(1240), "1,240 points");
  assert.equal(formatPlayerPoints(0, { short: true }), "0 pts");
  assert.equal(formatPlayerPoints(undefined), "");
});

test("compact and inline variants enforce badge hierarchy", () => {
  const compact = normalizePlayerIdentity({ username: "Ama", rank: 2, points: 1200, status: "active", role: "player" }, { variant: "compact" });
  const inline = normalizePlayerIdentity({ username: "Ama", rank: 2, points: 1200 }, { variant: "inline" });
  assert.deepEqual(getIdentityBadges(compact).map((badge) => badge.id), ["rank", "points"]);
  assert.deepEqual(getIdentityBadges(inline).map((badge) => badge.id), ["rank"]);
});

test("unsupported competitive concepts are not normalized or invented", () => {
  const identity = normalizePlayerIdentity({ username: "Ama", division: "Elite", level: 99, streak: 8, rating: 3000, achievements: ["fake"], reputation: 100 });
  for (const key of ["division", "level", "streak", "rating", "achievements", "reputation", "verified"]) {
    assert.equal(Object.hasOwn(identity, key), false);
  }
});

test("normalization does not mutate API source objects", () => {
  const source = Object.freeze({ id: "p1", username: "@Player", points: 5 });
  normalizePlayerIdentity(source, { variant: "leaderboard", isCurrent: true });
  assert.deepEqual(source, { id: "p1", username: "@Player", points: 5 });
});

test("avatar supports sizes, loading placeholders, initials, neutral fallback, and broken images", () => {
  assert.match(avatar, /size = "lg"/);
  assert.match(avatar, /profile-avatar--\$\{size\}/);
  assert.match(avatar, /profile-avatar-placeholder/);
  assert.match(avatar, /getAvatarInitials/);
  assert.match(avatar, /profile-avatar-default-icon/);
  assert.match(avatar, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(avatar, /loading=\{loading\}/);
});

test("identity variants, skeletons, accessible names, and keyboard links share one component", () => {
  for (const variant of ["full", "compact", "inline", "leaderboard", "match", "admin"]) {
    assert.match(component, new RegExp(`${variant}`));
  }
  assert.match(component, /`player-identity--\$\{variant\}`/);
  assert.match(css, /\.player-identity\s*\{/);
  assert.match(component, /PlayerIdentitySkeleton/);
  assert.match(component, /title=\{identity\.displayName\}/);
  assert.match(component, /<span className="sr-only">\{identity\.displayName\}<\/span>/);
  assert.match(component, /<Link[\s\S]*?aria-label=\{accessibleLabel\}/);
});

test("identity styling covers dark, light, mobile, wrapping, and visible focus", () => {
  assert.match(css, /html\[data-theme="light"\] \.profile-avatar/);
  assert.match(css, /\.player-identity__badges[\s\S]*?flex-wrap: wrap/);
  assert.match(css, /\.player-identity--linked:focus-visible/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?player-identity--full/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*?player-identity--full/);
  assert.match(css, /text-overflow: ellipsis/);
});
