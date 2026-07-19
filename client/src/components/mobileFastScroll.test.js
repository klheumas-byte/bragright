import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const component = readFileSync(new URL("components/MobileFastScroll.jsx", root), "utf8");
const layout = readFileSync(new URL("layouts/DashboardLayout.jsx", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");

test("mobile shell provides instant top and bottom shortcuts", () => {
  assert.match(layout, /isMobileView \? <MobileFastScroll/);
  assert.match(component, /Jump to top of page/);
  assert.match(component, /Jump to bottom of page/);
  assert.match(component, /behavior: "auto"/);
});

test("scroll tracking is passive, frame-limited, and cleaned up", () => {
  assert.match(component, /requestAnimationFrame/);
  assert.match(component, /\{ passive: true \}/);
  assert.match(component, /cancelAnimationFrame/);
  assert.match(component, /ResizeObserver/);
  assert.match(component, /resizeObserver\?\.disconnect/);
  assert.match(component, /removeEventListener\("scroll"/);
  assert.match(component, /removeEventListener\("resize"/);
});

test("fast-scroll controls respect safe areas, touch size, focus, and desktop hiding", () => {
  assert.match(css, /\.mobile-fast-scroll[\s\S]*?safe-area-inset-bottom/);
  assert.match(css, /\.mobile-fast-scroll button[\s\S]*?width: 48px[\s\S]*?height: 48px/);
  assert.match(css, /touch-action: manipulation/);
  assert.match(css, /\.mobile-fast-scroll button:focus-visible/);
  assert.match(css, /@media \(min-width: 901px\)[\s\S]*?\.mobile-fast-scroll \{ display: none/);
});
