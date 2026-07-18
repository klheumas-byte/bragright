export const THEME_STORAGE_KEY = "bragright_theme_preference";
export const THEME_PREFERENCES = Object.freeze(["light", "dark", "system"]);

export function normalizeThemePreference(value) {
  return THEME_PREFERENCES.includes(value) ? value : "system";
}

export function resolveTheme(preference, systemPrefersDark) {
  const normalized = normalizeThemePreference(preference);
  return normalized === "system" ? (systemPrefersDark ? "dark" : "light") : normalized;
}
