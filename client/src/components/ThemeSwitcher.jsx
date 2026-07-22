import { useEffect, useRef, useState } from "react";
import { useTheme } from "../context/ThemeContext";
import SidebarIcon from "./SidebarIcon";

export const THEME_OPTIONS = Object.freeze([
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "system" },
]);

export function ThemeSwitcher() {
  const { preference, effectiveTheme, setPreference } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const activeOption = THEME_OPTIONS.find((option) => option.value === preference) || THEME_OPTIONS[2];

  useEffect(() => {
    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape" && isOpen) {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="theme-switcher" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-switcher-trigger"
        aria-label={`Appearance: ${activeOption.label}. Effective theme: ${effectiveTheme}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        title="Change appearance"
        onClick={() => setIsOpen((current) => !current)}
      >
        <SidebarIcon name={activeOption.icon} decorative />
      </button>
      {isOpen ? (
        <div className="theme-switcher-menu" role="menu" aria-label="Appearance">
          <p className="theme-switcher-label">Appearance</p>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === option.value}
              className={`theme-switcher-option${preference === option.value ? " theme-switcher-option-active" : ""}`}
              onClick={() => {
                setPreference(option.value);
                setIsOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <SidebarIcon name={option.icon} decorative />
              <span>{option.label}</span>
              {preference === option.value ? <SidebarIcon name="check" decorative /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AppearanceSettings() {
  const { preference, effectiveTheme, setPreference } = useTheme();
  return (
    <section className="dashboard-panel appearance-settings" aria-labelledby="appearance-settings-title">
      <div>
        <p className="panel-kicker">Personal preference</p>
        <h2 className="panel-title" id="appearance-settings-title">Appearance</h2>
        <p className="appearance-settings-copy">Light is the default. You can choose Dark Arena or follow this device; System currently resolves to {effectiveTheme}.</p>
      </div>
      <div className="appearance-option-grid" role="radiogroup" aria-label="Theme preference">
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={preference === option.value}
            className={`appearance-option${preference === option.value ? " appearance-option-active" : ""}`}
            onClick={() => setPreference(option.value)}
          >
            <SidebarIcon name={option.icon} decorative />
            <strong>{option.label}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
