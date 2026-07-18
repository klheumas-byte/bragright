import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "./themePreference";

const DARK_MODE_QUERY = "(prefers-color-scheme: dark)";
const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readStoredPreference);
  const [systemPrefersDark, setSystemPrefersDark] = useState(readSystemPreference);
  const transitionTimerRef = useRef(null);
  const effectiveTheme = resolveTheme(preference, systemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia(DARK_MODE_QUERY);
    const handleChange = (event) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(mediaQuery.matches);
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener?.(handleChange);
    return () => mediaQuery.removeListener?.(handleChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme && root.dataset.theme !== effectiveTheme) {
      root.classList.add("theme-transition");
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = window.setTimeout(() => root.classList.remove("theme-transition"), 280);
    }
    root.dataset.theme = effectiveTheme;
    root.dataset.themePreference = preference;
    root.style.colorScheme = effectiveTheme;
  }, [effectiveTheme, preference]);

  useEffect(() => () => window.clearTimeout(transitionTimerRef.current), []);

  function setPreference(nextPreference) {
    const normalized = normalizeThemePreference(nextPreference);
    setPreferenceState(normalized);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, normalized);
    } catch {
      // Storage can be unavailable in hardened browsing modes; the live choice still applies.
    }
  }

  const value = useMemo(
    () => ({ preference, effectiveTheme, setPreference }),
    [effectiveTheme, preference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}

function readStoredPreference() {
  try {
    return normalizeThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function readSystemPreference() {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_MODE_QUERY).matches;
}
