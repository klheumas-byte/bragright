export const THEME_STORAGE_KEY = "bragright_theme_preference";
export const THEME_PREFERENCES = Object.freeze(["light", "dark", "system"]);
export const DEFAULT_THEME_PREFERENCE = "light";

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference, systemPrefersDark) {
  const normalized = normalizeThemePreference(preference);
  return normalized === "system" ? (systemPrefersDark ? "dark" : "light") : normalized;
}
