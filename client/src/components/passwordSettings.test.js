import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const app = readFileSync(new URL("App.jsx", root), "utf8");
const route = readFileSync(new URL("components/ProtectedRoute.jsx", root), "utf8");
const page = readFileSync(new URL("pages/PasswordSettings.jsx", root), "utf8");
const context = readFileSync(new URL("context/AuthContext.jsx", root), "utf8");
const api = readFileSync(new URL("services/api.js", root), "utf8");
const navigation = readFileSync(new URL("components/sidebarNavigation.js", root), "utf8");

test("every authenticated account can open password settings", () => {
  assert.match(app, /path="\/account\/password"/);
  assert.match(navigation, /PLAYER_NAVIGATION_ITEMS[\s\S]*?\/account\/password/);
  assert.match(navigation, /ADMIN_NAVIGATION_ITEMS[\s\S]*?\/account\/password/);
  assert.match(navigation, /PAYMENT_NAVIGATION_ITEMS[\s\S]*?\/account\/password/);
});

test("temporary-password accounts must choose a preferred password", () => {
  assert.match(route, /must_change_password === true[\s\S]*?\/account\/password/);
  assert.match(page, /Replace your temporary password/);
  assert.match(page, /mandatory[\s\S]*?navigate\(getHomePathForRole/);
});

test("password form requires current, preferred, and matching confirmation values", () => {
  assert.match(page, /name="current_password"/);
  assert.match(page, /name="new_password"/);
  assert.match(page, /name="confirm_password"/);
  assert.match(page, /minLength="8"/);
  assert.match(page, /form\.new_password !== form\.confirm_password/);
  assert.match(page, /form\.new_password === form\.current_password/);
  assert.match(page, /PASSWORD_MIN_LENGTH/);
  assert.match(page, /PASSWORD_MAX_LENGTH/);
  assert.match(page, /autoComplete="new-password"/);
});

test("password updates use the authenticated API and refresh session identity", () => {
  assert.match(api, /apiMutation\("\/auth\/password"/);
  assert.match(context, /changeCurrentUserPassword[\s\S]*?updateSessionUser\(normalizedUser\)/);
  assert.doesNotMatch(page, /localStorage|sessionStorage/);
});
