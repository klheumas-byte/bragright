import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_THEME_PREFERENCE,
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./themePreference.js";

test("theme preferences preserve light, dark, and system", () => {
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference("dark"), "dark");
  assert.equal(normalizeThemePreference("system"), "system");
  assert.equal(normalizeThemePreference("unknown"), "light");
  assert.equal(normalizeThemePreference(null), "light");
  assert.equal(DEFAULT_THEME_PREFERENCE, "light");
  assert.equal(THEME_STORAGE_KEY, "bragright_theme_preference");
});

test("system resolves against the live device preference", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("system", false), "light");
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});
