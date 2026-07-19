import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const tokens = readFileSync(new URL("styles/tokens.css", root), "utf8");
const designSystem = readFileSync(new URL("styles/design-system.css", root), "utf8");
const premiumTheme = readFileSync(new URL("styles/premium-theme.css", root), "utf8");
const main = readFileSync(new URL("main.jsx", root), "utf8");

test("the canonical premium layer loads after retained page styles", () => {
  assert.ok(main.indexOf('import "./index.css"') < main.indexOf('import "./styles/premium-theme.css"'));
  assert.match(premiumTheme, /Phase 3\.4A canonical presentation layer/);
  assert.doesNotMatch(premiumTheme, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("light and dark themes expose one semantic palette and three elevations", () => {
  assert.match(tokens, /html\[data-theme="dark"\][\s\S]*?--accent-prestige:/);
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--accent-prestige:/);
  assert.match(tokens, /--elevation-background:\s*none/);
  assert.match(tokens, /--elevation-card:/);
  assert.match(tokens, /--elevation-featured:/);
  assert.match(tokens, /--shadow-card:\s*var\(--elevation-card\)/);
  assert.match(tokens, /--shadow-elevated:\s*var\(--elevation-featured\)/);
});

test("shared controls and surfaces consume semantic design tokens", () => {
  assert.match(designSystem, /min-height:\s*var\(--control-height-md\)/);
  assert.match(designSystem, /background:\s*var\(--color-success-surface\)/);
  assert.match(premiumTheme, /\.ui-button--primary[\s\S]*?var\(--gradient-primary\)/);
  assert.match(premiumTheme, /\.dashboard-sidebar[\s\S]*?var\(--surface-primary\)/);
  assert.match(premiumTheme, /\.momentum-bar[\s\S]*?var\(--gradient-primary\)/);
});

test("light panels, sidebar icons, and opponent selection retain visible contrast", () => {
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--surface-panel:\s*#d8e5e8/);
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--icon-surface-strong:\s*#bcd7da/);
  assert.match(tokens, /html\[data-theme="light"\][\s\S]*?--icon-border:\s*#759da4/);
  assert.match(premiumTheme, /\.sidebar-link-icon\s*\{[\s\S]*?background:\s*var\(--icon-surface-strong\)[\s\S]*?color:\s*var\(--icon-primary\)/);
  assert.match(premiumTheme, /\.sidebar-link-active \.sidebar-link-icon[\s\S]*?background:\s*var\(--accent-primary-strong\)/);
  assert.match(premiumTheme, /\.opponent-option-card\.opponent-option-selected[\s\S]*?border:\s*2px solid var\(--accent-primary-strong\)[\s\S]*?background:\s*var\(--surface-panel-strong\)/);
  assert.match(premiumTheme, /\.opponent-selected-check[\s\S]*?background:\s*var\(--accent-primary-strong\)/);
});

test("all official match statuses have theme-independent semantic mappings", () => {
  for (const status of ["pending", "accepted", "completed", "cancelled", "disputed", "resolved", "draft", "expired"]) {
    assert.match(premiumTheme, new RegExp(`data-status=\\"${status}\\"`));
  }
  assert.match(premiumTheme, /prefers-reduced-motion:\s*reduce/);
  assert.match(premiumTheme, /forced-colors:\s*active/);
  assert.match(premiumTheme, /@media \(max-width:\s*640px\)/);
});
