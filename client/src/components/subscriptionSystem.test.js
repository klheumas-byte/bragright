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
const checkout = readFileSync(new URL("pages/PaystackCheckout.jsx", root), "utf8");
const callback = readFileSync(new URL("pages/PaystackCallback.jsx", root), "utf8");
const payAhead = readFileSync(new URL("components/PayAheadPanel.jsx", root), "utf8");
const api = readFileSync(new URL("services/api.js", root), "utf8");
const playerDirectory = readFileSync(new URL("context/PlayerDirectoryContext.jsx", root), "utf8");
const theme = readFileSync(new URL("styles/premium-theme.css", root), "utf8");

test("payment officers receive only payment navigation and role-scoped routes", () => {
  assert.match(navigation, /PAYMENT_NAVIGATION_ITEMS[\s\S]*?\/payments\/dashboard[\s\S]*?\/payments\/record/);
  const paymentNavigation = navigation.match(/PAYMENT_NAVIGATION_ITEMS[\s\S]*?\]\);/)?.[0] || "";
  assert.doesNotMatch(paymentNavigation, /\/payments\/remittances/);
  assert.match(sidebar, /user\?\.role === "payment_officer"[\s\S]*?PAYMENT_NAVIGATION_ITEMS/);
  assert.match(app, /allowedRoles=\{\["payment_officer"\]\}/);
  assert.match(app, /\/admin\/payments[\s\S]*?requireAdmin/);
  assert.match(playerDirectory, /user\?\.role === "payment_officer"/);
});

test("restricted players are centralized onto the subscription status route", () => {
  assert.match(protectedRoute, /requireSubscription[\s\S]*?subscription_access === false[\s\S]*?\/payments\/status/);
  assert.match(app, /\/dashboard"[\s\S]*?requireSubscription/);
  assert.match(app, /\/matches\/:matchId\/result\/submit"[\s\S]*?requireSubscription/);
  assert.match(navigation, /RESTRICTED_PLAYER_NAVIGATION_ITEMS[\s\S]*?\/payments\/status/);
});

test("active and restricted players can reach the mounted subscription page from navigation", () => {
  assert.match(navigation, /PLAYER_NAVIGATION_ITEMS[\s\S]*?label: "Subscription"[\s\S]*?to: "\/payments\/status"/);
  assert.match(navigation, /RESTRICTED_PLAYER_NAVIGATION_ITEMS[\s\S]*?label: "Subscription"[\s\S]*?to: "\/payments\/status"/);
  assert.match(app, /path="\/payments\/status"[\s\S]*?<SubscriptionStatus/);
  assert.match(status, /<PayAheadPanel[\s\S]*?pay_ahead_options/);
  assert.doesNotMatch(status, /access\?\.allowed\s*&&[\s\S]{0,120}<PayAheadPanel/);
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

test("subscription navigation preloads its route and cached status without blanking refreshes", () => {
  assert.match(sidebar, /import\("\.\.\/pages\/SubscriptionStatus"\)/);
  assert.match(sidebar, /getSubscriptionStatus\(\)\.catch/);
  assert.match(api, /subscription-status:\$\{billingMonth \|\| "current"\}/);
  assert.match(api, /getSubscriptionStatus[\s\S]*?cachedApiRequest/);
  assert.match(status, /state\.loading && !state\.data/);
  assert.match(status, /aria-busy=\{state\.loading\}/);
  assert.doesNotMatch(status, /state\.loading \? \([\s\S]{0,160}<div className="subscription-layout">/);
});

test("financial layouts collapse safely for mobile without horizontal tables", () => {
  assert.match(theme, /@media \(max-width:\s*640px\)[\s\S]*?\.financial-summary-grid[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(theme, /\.financial-card-list/);
  assert.doesNotMatch(operations, /<table/);
});

test("Paystack checkout uses hosted Mobile Money and callback verification", () => {
  assert.match(app, /\/payments\/paystack\/callback/);
  assert.match(checkout, /<PayAheadPanel[\s\S]*?pay_ahead_options/);
  assert.match(payAhead, /PAY AHEAD/);
  assert.match(payAhead, /Monthly rate/);
  assert.match(payAhead, /Months selected/);
  assert.match(payAhead, /options\.map/);
  assert.match(payAhead, /option\.total/);
  assert.match(payAhead, /formatCoverage\(selected\)/);
  assert.match(payAhead, /initializePaystackPayment\(selected\.months\)/);
  assert.match(payAhead, /Pay \$\{formatMoney\(selected\?\.total, currency\)\} with MoMo/);
  assert.match(payAhead, /window\.location\.assign\(authorizationUrl\)/);
  assert.match(payAhead, /initializationInFlight\.current/);
  assert.match(payAhead, /Payment Failed/);
  assert.doesNotMatch(payAhead, /<(?:input|textarea)/i);
  assert.match(callback, /Confirming your payment securely/);
  assert.match(callback, /verifyPaystackPayment\(reference\)/);
  assert.match(callback, /CONFIRMATION_POLL_INTERVAL_MS = 5_000/);
  assert.match(callback, /CONFIRMATION_TIMEOUT_MS = 75_000/);
  assert.match(callback, /Payment Successful/);
  assert.match(callback, /Processing Payment/);
  assert.match(callback, /Payment Pending/);
  assert.match(callback, /Payment Failed/);
  assert.match(callback, /Payment Abandoned/);
  assert.match(callback, /Payment Reversed/);
  assert.match(callback, /Still confirming/);
  assert.match(callback, /Check Status/);
  assert.match(api, /skipNetworkRetry: true/);
  assert.match(status, /PayAheadPanel/);
  assert.match(status, /paymentCoverage\(payment\)/);
  assert.ok(api.includes("/payments/paystack/initialize"));
  assert.ok(api.includes("/payments/paystack/verify"));
  assert.doesNotMatch(api, /PAYSTACK_SECRET_KEY/);
});
