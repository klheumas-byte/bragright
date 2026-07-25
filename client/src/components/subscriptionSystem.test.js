import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const app = readFileSync(new URL("App.jsx", root), "utf8");
const protectedRoute = readFileSync(new URL("components/ProtectedRoute.jsx", root), "utf8");
const sidebar = readFileSync(new URL("components/Sidebar.jsx", root), "utf8");
const navigation = readFileSync(new URL("components/sidebarNavigation.js", root), "utf8");
const operations = readFileSync(new URL("pages/PaymentOperations.jsx", root), "utf8");
const status = readFileSync(new URL("pages/SubscriptionStatus.jsx", root), "utf8");
const api = readFileSync(new URL("services/api.js", root), "utf8");
const theme = readFileSync(new URL("styles/premium-theme.css", root), "utf8");

test("payment officers receive only payment navigation and role-scoped routes", () => {
  assert.match(navigation, /PAYMENT_NAVIGATION_ITEMS[\s\S]*?\/payments\/dashboard[\s\S]*?\/payments\/record/);
  const paymentNavigation = navigation.match(/PAYMENT_NAVIGATION_ITEMS[\s\S]*?\]\);/)?.[0] || "";
  assert.doesNotMatch(paymentNavigation, /\/payments\/remittances/);
  assert.match(sidebar, /user\?\.role === "payment_officer"[\s\S]*?PAYMENT_NAVIGATION_ITEMS/);
  assert.match(app, /allowedRoles=\{\["payment_officer"\]\}/);
  assert.match(app, /\/admin\/payments[\s\S]*?requireAdmin/);
});

test("restricted players are centralized onto the subscription status route", () => {
  assert.match(protectedRoute, /requireSubscription[\s\S]*?subscription_access === false[\s\S]*?\/payments\/status/);
  assert.match(app, /\/dashboard"[\s\S]*?requireSubscription/);
  assert.match(app, /\/matches\/:matchId\/result\/submit"[\s\S]*?requireSubscription/);
  assert.match(navigation, /RESTRICTED_PLAYER_NAVIGATION_ITEMS[\s\S]*?\/payments\/status/);
});

test("financial screens use authoritative APIs and never edit calculated balances", () => {
  for (const endpoint of [
    "/payments/dashboard",
    "/payments/payments",
    "/payments/remittances",
    "/payments/exemptions",
    "/payments/billing/run",
  ]) {
    assert.ok(api.includes(endpoint), `${endpoint} must be centralized in the API service`);
  }
  assert.match(operations, /getPaymentSettings/);
  assert.doesNotMatch(operations, /name="(?:outstanding_balance|total_collected|total_remitted)"/);
  assert.doesNotMatch(operations, /amount:\s*"20\.00"/);
});

test("one failed payment summary request does not discard the player selector", () => {
  assert.match(operations, /Promise\.allSettled/);
  assert.match(operations, /playerResult\.status === "fulfilled"[\s\S]*?setPlayers/);
  assert.match(operations, /failedResult[\s\S]*?Some payment information could not be loaded/);
});

test("payment status, empty, loading, error, and semantic states remain visible", () => {
  assert.match(status, /loading:\s*true/);
  assert.match(status, /role="alert"/);
  assert.match(status, /No payments have been recorded yet/);
  assert.match(status, /statusTone/);
  assert.match(theme, /\.financial-record-card[\s\S]*?var\(--border-default\)[\s\S]*?var\(--bg-surface\)/);
});

test("financial layouts collapse safely for mobile without horizontal tables", () => {
  assert.match(theme, /@media \(max-width:\s*640px\)[\s\S]*?\.financial-summary-grid[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(theme, /\.financial-card-list/);
  assert.doesNotMatch(operations, /<table/);
});
