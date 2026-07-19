import { useEffect, useRef, useState } from "react";
import ProfileAvatar from "./ProfileAvatar";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { NotificationBell } from "../notifications/NotificationCenter";

// DashboardHeader is the top card for dashboard pages.
// It keeps the page label, title, and avatar together in one reusable section.
export default function DashboardHeader({
  label,
  title,
  description,
  identityLabel,
  identityMeta,
  avatarImage = "",
  onLogout,
  onSidebarToggle,
  isSidebarOpen,
  isMobileView,
  sidebarButtonRef,
}) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!userMenuRef.current?.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const sidebarButtonLabel = isSidebarOpen
    ? "Close navigation menu"
    : "Open navigation menu";

  return (
    <header className="dashboard-header">
      <div className="dashboard-header-main">
        {isMobileView ? (
          <button
            ref={sidebarButtonRef}
            type="button"
            className="dashboard-menu-button"
            aria-label={sidebarButtonLabel}
            aria-expanded={isSidebarOpen}
            onClick={onSidebarToggle}
          >
            <span />
            <span />
            <span />
          </button>
        ) : null}

        <div>
          <p className="dashboard-header-label">{label}</p>
          <h1 className="dashboard-header-title">{title}</h1>
          {description ? <p className="dashboard-header-description">{description}</p> : null}
        </div>
      </div>

      <div className="dashboard-header-actions">
        <NotificationBell />
        <ThemeSwitcher />
        <div className="dashboard-user-area" ref={userMenuRef}>
        <button
          type="button"
          className="dashboard-user-trigger"
          aria-expanded={isUserMenuOpen}
          aria-haspopup="menu"
          onClick={() => setIsUserMenuOpen((currentValue) => !currentValue)}
        >
          <div className="dashboard-user-meta">
            <ProfileAvatar
              image={avatarImage}
              name={identityLabel}
              size="sm"
              className="dashboard-avatar"
            />
            <div>
              <p className="dashboard-user-label">Signed in</p>
              <p className="dashboard-user-name">{identityLabel}</p>
              {identityMeta ? <p className="dashboard-user-meta-copy">{identityMeta}</p> : null}
            </div>
          </div>
          <span className={`dashboard-user-caret${isUserMenuOpen ? " dashboard-user-caret-open" : ""}`} />
        </button>

        {isUserMenuOpen ? (
          <div className="dashboard-user-menu" role="menu" aria-label="User options">
            <p className="dashboard-user-menu-label">Account</p>
            <p className="dashboard-user-menu-name">{identityLabel}</p>
            {identityMeta ? <p className="dashboard-user-menu-copy">{identityMeta}</p> : null}
            <button
              type="button"
              className="dashboard-logout-button"
              role="menuitem"
              onClick={() => {
                setIsUserMenuOpen(false);
                onLogout();
              }}
            >
              Logout
            </button>
          </div>
        ) : null}
        </div>
      </div>
    </header>
  );
}
