import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const premium = read("styles/premium-theme.css");
const css = `${read("index.css")}\n${premium}`;
const main = read("main.jsx");
const themeContext = read("context/ThemeContext.jsx");

test("the last-loaded stylesheet owns the approved dark and light visibility tokens", () => {
  assert.match(main, /import "\.\/styles\/premium-theme\.css";/);
  for (const [token, dark, light] of [
    ["bg-page", "#0D1B2A", "#F2F6F9"],
    ["bg-navigation", "#10243A", "#FFFFFF"],
    ["bg-surface", "#162C44", "#FFFFFF"],
    ["bg-surface-elevated", "#1C3854", "#F8FAFC"],
    ["bg-surface-hover", "#223F5D", "#EAF2F7"],
    ["border-default", "#294866", "#CBD8E3"],
    ["border-strong", "#3B5F7E", "#9FB4C6"],
    ["text-primary", "#F4F7FB", "#10243A"],
    ["text-secondary", "#B7C6D5", "#40566B"],
    ["primary", "#2DD4BF", "#0F8F83"],
  ]) {
    assert.match(premium, new RegExp(`--${token}: ${dark}`));
    assert.match(premium, new RegExp(`html\\[data-theme="light"\\][\\s\\S]*--${token}: ${light}`));
  }
});

test("component states use semantic tokens instead of component-level color literals", () => {
  for (const selector of [
    "ui-button--primary", "ui-button--secondary", "ui-button--danger",
    "ui-button--success", "ui-switch-control", "sidebar-link-active",
    "theme-switcher-option-active", "notification-drawer__tabs button.active",
    "match-view-tab-active", "ui-table tbody tr:nth-child", "skeleton",
  ]) assert.match(premium, new RegExp(selector.replaceAll(".", "\\.")));
  assert.match(premium, /focus-visible[\s\S]*outline: 3px solid var\(--primary\)/);
  assert.match(premium, /:disabled[\s\S]*color: var\(--text-disabled\)/);
});

test("overlays, notifications, data surfaces, and focused match actions remain theme aware", () => {
  assert.match(premium, /ui-modal[\s\S]*notification-drawer[\s\S]*background: var\(--bg-surface-elevated\)/);
  assert.match(premium, /ui-table th[\s\S]*background: var\(--bg-surface-elevated\)/);
  assert.match(premium, /notification-bell__count[\s\S]*background: var\(--warning\)/);
  assert.match(premium, /match-action-score strong[\s\S]*color: var\(--primary\)/);
  assert.match(css, /match-action-sticky[\s\S]*env\(safe-area-inset-bottom\)/);
  assert.match(premium, /momentum-chart[\s\S]*stroke: var\(--border-default\)/);
});

test("browser chrome follows the active semantic page token", () => {
  assert.match(themeContext, /getPropertyValue\("--bg-page"\)/);
  assert.doesNotMatch(themeContext, /#0e1a24|#f2f7f7/i);
});

test("visibility refinements retain small-screen and reduced-motion safeguards", () => {
  assert.match(premium, /@media \(max-width: 640px\)/);
  assert.match(premium, /env\(safe-area-inset-bottom\)/);
  assert.match(premium, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: \.01ms/);
  assert.match(premium, /@media \(forced-colors: active\)/);
});
