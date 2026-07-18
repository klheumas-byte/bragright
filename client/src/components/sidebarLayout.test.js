import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const css = readFileSync(new URL("index.css", root), "utf8");
const tokens = readFileSync(new URL("styles/tokens.css", root), "utf8");
const designSystem = readFileSync(new URL("styles/design-system.css", root), "utf8");
const layout = readFileSync(new URL("layouts/DashboardLayout.jsx", root), "utf8");
const sidebar = readFileSync(new URL("components/Sidebar.jsx", root), "utf8");

test("desktop shell reserves a stable collapsed rail and fixes the sidebar", () => {
  assert.match(tokens, /--sidebar-rail-width:\s*76px/);
  assert.match(tokens, /--sidebar-expanded-width:\s*264px/);
  assert.match(css, /\.dashboard-sidebar\.dashboard-sidebar-desktop\s*\{[\s\S]*?position:\s*fixed/);
  assert.match(css, /padding:[\s\S]*?calc\(var\(--sidebar-rail-width\)/);
  assert.doesNotMatch(layout, /bragright_sidebar_collapsed|readStoredSidebarPreference/);
  assert.match(layout, /isCollapsed=\{!isMobileView\}/);
});

test("desktop rail expands on pointer hover and keyboard focus without changing main width", () => {
  assert.match(css, /dashboard-sidebar\.dashboard-sidebar-desktop:hover/);
  assert.match(css, /dashboard-sidebar\.dashboard-sidebar-desktop:focus-within/);
  assert.match(css, /width:\s*var\(--sidebar-expanded-width\)/);
  assert.doesNotMatch(css.slice(css.indexOf("Global competitive gaming shell enhancement")), /grid-template-columns:\s*var\(--sidebar-expanded-width\)/);
  assert.match(designSystem, /@media \(prefers-reduced-motion: reduce\)/);
});

test("profile and footer stay outside the independently scrolling navigation", () => {
  assert.match(sidebar, /<SidebarUserBlock[\s\S]*?<nav ref=\{navigationRef\}[\s\S]*?<div className="sidebar-footer">/);
  assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.dashboard-sidebar-desktop \.sidebar-nav\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(sidebar, /SIDEBAR_SCROLL_STORAGE_KEY/);
  assert.match(sidebar, /className="sidebar-logout"/);
});

test("collapsed navigation remains identifiable and keyboard accessible", () => {
  assert.match(sidebar, /title=\{isCollapsed \? item\.label : undefined\}/);
  assert.match(sidebar, /aria-label=\{isCollapsed \? item\.label : undefined\}/);
  assert.match(sidebar, /aria-label="Primary navigation"/);
  assert.match(css, /\.sidebar-link-active/);
  assert.match(css, /focus-within \.sidebar-link-label/);
});

test("mobile and coarse-pointer devices use a focus-managed drawer", () => {
  assert.match(layout, /\(max-width: 900px\), \(hover: none\), \(pointer: coarse\)/);
  assert.match(layout, /dashboard-mobile-menu-open/);
  assert.match(layout, /requestAnimationFrame\(\(\) => sidebarToggleRef\.current\?\.focus\(\)\)/);
  assert.match(sidebar, /event\.key !== "Tab"/);
  assert.match(sidebar, /aria-modal=\{isMobileView && isOpen \? "true" : undefined\}/);
  assert.match(css, /\.dashboard-sidebar-open\s*\{[\s\S]*?transform:\s*translateX\(0\)/);
});

test("gaming primitives retain focus, loading, modal, and reduced-motion safeguards", () => {
  assert.match(designSystem, /\.ui-button:focus-visible/);
  assert.match(designSystem, /\.ui-card--loading/);
  assert.match(designSystem, /z-index:\s*var\(--z-modal\)/);
  assert.match(designSystem, /prefers-reduced-motion:\s*reduce/);
  assert.match(tokens, /--gradient-arena/);
  assert.match(tokens, /--gradient-energy/);
});
