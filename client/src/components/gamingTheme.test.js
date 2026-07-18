import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const tokens = readFileSync(new URL("styles/tokens.css", root), "utf8");
const designSystem = readFileSync(new URL("styles/design-system.css", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");
const feedback = readFileSync(new URL("components/ui/Feedback.jsx", root), "utf8");
const competitiveBadge = readFileSync(new URL("components/CompetitiveBadge.jsx", root), "utf8");

test("authenticated screens use the centralized esports palette", () => {
  assert.match(tokens, /--arena-canvas:\s*#071426/);
  assert.match(tokens, /--arena-royal-blue:\s*#176bff/);
  assert.match(tokens, /--arena-teal:\s*#11c7b3/);
  assert.match(tokens, /--arena-purple:\s*#8d5cf6/);
  assert.match(tokens, /--arena-gold:\s*#f6c453/);
  assert.match(tokens, /\.dashboard-shell\s*\{[\s\S]*?--color-surface:\s*var\(--arena-surface\)/);
  assert.match(css, /\.dashboard-shell\s*\{[\s\S]*?var\(--arena-canvas\)/);
});

test("rank and points have semantic icons, text, and accessible descriptions", () => {
  assert.match(competitiveBadge, /kind === "rank"/);
  assert.match(competitiveBadge, /Current rank:/);
  assert.match(competitiveBadge, /name=\{isRank \? "crown" : "bolt"\}/);
  assert.match(designSystem, /\.ui-badge--champion/);
  assert.match(designSystem, /\.ui-badge--energy/);
});

test("status badges and empty states include consistent icons", () => {
  assert.match(feedback, /BADGE_TONE_ICONS/);
  assert.match(feedback, /success:\s*"check"/);
  assert.match(feedback, /warning:\s*"clock"/);
  assert.match(feedback, /icon = <SidebarIcon name="activity" decorative \/>/);
  assert.match(designSystem, /\.ui-empty-state__icon/);
});

test("collapsed navigation exposes a visible custom tooltip layer", () => {
  assert.match(css, /dashboard-sidebar-desktop \.sidebar-tooltip\s*\{[\s\S]*?z-index:\s*var\(--z-popover\)/);
  assert.match(css, /sidebar-tooltip-peek/);
  assert.match(tokens, /--z-modal:\s*140/);
  assert.match(tokens, /--z-sidebar:\s*30/);
});

test("challenge and premium actions are available without changing behavior", () => {
  assert.match(designSystem, /\.ui-button--challenge/);
  assert.match(designSystem, /\.ui-button--premium/);
  assert.match(designSystem, /prefers-reduced-motion:\s*reduce/);
});
