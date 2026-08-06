import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const submitMatch = readFileSync(new URL("pages/SubmitMatch.jsx", root), "utf8");
const css = readFileSync(new URL("index.css", root), "utf8");

test("Challenge Player keeps the existing search, selection, and submission flow", () => {
  assert.match(submitMatch, /getPlayers\(\{[\s\S]*?search: debouncedSearch/);
  assert.match(submitMatch, /filter\(\(player\) => player\.id !== user\?\.id\)/);
  assert.match(submitMatch, /scheduleMatch\(\{[\s\S]*?opponent_id: selectedOpponent\.id/);
  assert.match(submitMatch, /aria-pressed=\{selected\}/);
  assert.match(submitMatch, />Send Challenge<\/Button>/);
});

test("Challenge Player uses a compact responsive grid with safe truncation", () => {
  assert.match(css, /\.challenge-page-section \.opponent-results[\s\S]*?repeat\(auto-fill, minmax\(150px, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\), \(hover: none\), \(pointer: coarse\)[\s\S]*?\.challenge-page-section \.opponent-results[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 340px\)[\s\S]*?\.challenge-page-section \.opponent-results[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.challenge-page-section \.opponent-option-card[\s\S]*?height: 100%[\s\S]*?overflow: hidden/);
  assert.match(css, /\.player-identity__name,[\s\S]*?\.player-identity__username/);
});

test("Challenge Player submit dock clears mobile navigation and safe areas", () => {
  assert.match(submitMatch, /className="challenge-submit-action"/);
  assert.match(submitMatch, /document\.body\.classList\.add\("challenge-player-route"\)[\s\S]*?classList\.remove\("challenge-player-route"\)/);
  assert.match(css, /\.challenge-form[\s\S]*?padding-bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.challenge-submit-action[\s\S]*?position: fixed[\s\S]*?bottom: calc\(69px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /padding:[^;]*env\(safe-area-inset-right\)[^;]*env\(safe-area-inset-left\)/);
  assert.match(css, /\.challenge-player-route \.mobile-fast-scroll[\s\S]*?safe-area-inset-bottom/);
});
