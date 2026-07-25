import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildNotificationDestination,
  isActionRequiredEvent,
  normalizeNotificationEvents,
  notificationEventRegistry,
} from "./notificationEventRegistry.js";

const root = new URL("../", import.meta.url);
const provider = readFileSync(new URL("notifications/NotificationCenter.jsx", root), "utf8");
const sound = readFileSync(new URL("notifications/notificationSound.js", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");
const app = readFileSync(new URL("App.jsx", root), "utf8");
const header = readFileSync(new URL("components/DashboardHeader.jsx", root), "utf8");

test("registry supports only authoritative action-center event types", () => {
  assert.deepEqual(Object.keys(notificationEventRegistry).sort(), [
    "account_activated", "account_restricted", "dispute_requiring_review", "dispute_status", "exemption_granted", "match_cancelled", "match_confirmed", "match_request", "match_resolved", "payment_recorded", "payment_reversed", "remittance_rejected", "remittance_submitted", "remittance_verified", "result_awaiting_confirmation", "result_required",
  ]);
  assert.equal(notificationEventRegistry.match_request.priority, "action_required");
  assert.equal(notificationEventRegistry.dispute_status.actionRequired, false);
  assert.equal(notificationEventRegistry.match_cancelled.sound, false);
});

test("normalization separates unresolved actions from informational history", () => {
  const events = normalizeNotificationEvents([
    { id: "request-1", type: "match_request", related_match_id: "m1", message: "A challenged you" },
    { id: "cancelled-1", type: "match_cancelled", related_match_id: "m2", message: "Match cancelled" },
  ]);
  assert.equal(events[0].actionRequired, true);
  assert.equal(events[1].actionRequired, false);
  assert.equal(isActionRequiredEvent({ type: "dispute_status" }), false);
});

test("duplicate events and unsupported concepts are discarded", () => {
  const events = normalizeNotificationEvents([
    { id: "one", type: "match_request", related_match_id: "m1" },
    { id: "retry", type: "match_request", related_match_id: "m1" },
    { id: "fake", type: "ranking_change", related_match_id: "m1" },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].deduplicationKey, "match_request:m1");
});

test("deep links accept known protected destinations and reject external links", () => {
  assert.equal(buildNotificationDestination({ action_url: "/dashboard/matches?matchId=abc", type: "match_request" }), "/dashboard/matches?matchId=abc");
  assert.equal(buildNotificationDestination({ action_url: "https://evil.example/collect", type: "match_request" }), "/dashboard/matches");
  assert.equal(buildNotificationDestination({ action_url: "//evil.example/collect", type: "match_request" }), "/dashboard/matches");
});

test("one bounded leader poller handles visibility, focus, reconnect, and cleanup", () => {
  assert.match(provider, /VISIBLE_POLL_MS = 60_000/);
  assert.match(provider, /HIDDEN_POLL_MS = 300_000/);
  assert.match(provider, /requestInFlightRef\.current/);
  assert.match(provider, /claimAlertLeadership/);
  assert.match(provider, /BroadcastChannel/);
  assert.match(provider, /MAX_HEADS_UP = 3/);
  assert.match(provider, /clearTimeout/);
  assert.match(provider, /clearInterval/);
  assert.match(provider, /removeEventListener/);
});

test("refresh does not replay alerts and cross-account state is namespaced", () => {
  assert.match(provider, /bragright_notifications_\$\{kind\}_\$\{String\(userId/);
  assert.match(provider, /deduplicationKey/);
  assert.match(provider, /writeIdSet\("seen"/);
  assert.match(provider, /releaseLeadership/);
});

test("sound is optional, user-activated, strong, rate-limited, and non-looping", () => {
  assert.match(sound, /soundEnabled: false/);
  assert.match(sound, /SOUND_RATE_LIMIT_MS = 8_000/);
  assert.match(sound, /context\.resume/);
  assert.match(sound, /gainValue = strong \? 0\.45 : 0\.18/);
  assert.match(sound, /oscillator\.stop/);
  assert.doesNotMatch(sound, /\.loop\s*=|setInterval/);
});

test("bell, drawer, heads-up, preferences, and in-app fallback are globally integrated", () => {
  assert.match(app, /<NotificationProvider>/);
  assert.match(header, /<NotificationBell/);
  assert.match(provider, /NotificationViewport/);
  assert.match(provider, /NotificationDrawer/);
  assert.match(provider, /Action Required/);
  assert.match(provider, /in-app alerts remain active/i);
  assert.match(provider, /aria-live="polite"/);
  assert.match(provider, /role=\{item\.priority === "urgent" \? "alert" : "status"\}/);
});

test("notification UI supports safe areas, 320px-class mobile, themes, focus, and reduced motion", () => {
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /notification-drawer-item[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?heads-up/);
  assert.match(css, /var\(--surface-primary\)/);
});
