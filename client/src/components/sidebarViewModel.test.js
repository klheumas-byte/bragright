import assert from "node:assert/strict";
import test from "node:test";
import {
  getSidebarAvatarMode,
  getSidebarIdentity,
} from "./sidebarViewModel.js";
import {
  ADMIN_NAVIGATION_ITEMS,
  PLAYER_NAVIGATION_ITEMS,
} from "./sidebarNavigation.js";

test("sidebar identity prefers an uploaded avatar and display name", () => {
  const identity = getSidebarIdentity({
    display_name: "Maya Chen",
    username: "maya",
    profile_image: "/uploads/maya.png",
  });
  assert.equal(identity.displayName, "Maya Chen");
  assert.equal(identity.username, "maya");
  assert.equal(identity.initials, "MC");
  assert.equal(getSidebarAvatarMode(identity), "image");
});

test("sidebar avatar falls back from a failed image to initials", () => {
  const identity = getSidebarIdentity({
    username: "maya-chen",
    profile_image: "/uploads/missing.png",
  });
  assert.equal(identity.initials, "MC");
  assert.equal(getSidebarAvatarMode(identity, true), "initials");
});

test("sidebar avatar uses the default icon when identity data is unavailable", () => {
  const identity = getSidebarIdentity({});
  assert.equal(identity.initials, "");
  assert.equal(getSidebarAvatarMode(identity), "default");
});

test("every player and admin navigation item has an icon and valid route", () => {
  const items = [...PLAYER_NAVIGATION_ITEMS, ...ADMIN_NAVIGATION_ITEMS];
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(item.icon, `${item.label} should define an icon`);
    assert.ok(item.label, `${item.id} should define an accessible label`);
    assert.ok(item.to.startsWith("/"), `${item.label} should retain an internal route`);
  }
});
