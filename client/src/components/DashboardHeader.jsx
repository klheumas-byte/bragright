import { useEffect, useRef, useState } from "react";

// DashboardHeader is the top card for dashboard pages.
// It keeps the page label, title, and avatar together in one reusable section.
export default function DashboardHeader({
  label,
  title,
  description,
  identityLabel,
  identityMeta,
  avatarInitials = "BR",
  avatarImage = "",
  onLogout,
  onSidebarToggle,
  isSidebarOpen,
  isSidebarCollapsed,
  isMobileView,
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

  const sidebarButtonLabel = isMobileView
    ? isSidebarOpen
      ? "Close navigation menu"
      : "Open navigation menu"
    : isSidebarCollapsed
      ? "Expand sidebar"
      : "Collapse sidebar";

  return (
    <header className="dashboard-header">
      <div className="dashboard-header-main">
        <button
          type="button"
          className={`dashboard-menu-button${!isMobileView && isSidebarCollapsed ? " dashboard-menu-button-active" : ""}`}
          aria-label={sidebarButtonLabel}
          aria-expanded={isMobileView ? isSidebarOpen : !isSidebarCollapsed}
          onClick={onSidebarToggle}
        >
          <span />
          <span />
          <span />
        </button>

        <div>
          <p className="dashboard-header-label">{label}</p>
          <h1 className="dashboard-header-title">{title}</h1>
          {description ? <p className="dashboard-header-description">{description}</p> : null}
        </div>
      </div>

      <div className="dashboard-user-area" ref={userMenuRef}>
        <button
          type="button"
          className="dashboard-user-trigger"
          aria-expanded={isUserMenuOpen}
          aria-haspopup="menu"
          onClick={() => setIsUserMenuOpen((currentValue) => !currentValue)}
        >
          <div className="dashboard-user-meta">
            <div className="dashboard-avatar" aria-label="Current user">
              {avatarImage ? <img src={avatarImage} alt="" className="dashboard-avatar-image" /> : avatarInitials}
            </div>
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
    </header>
  );
}
