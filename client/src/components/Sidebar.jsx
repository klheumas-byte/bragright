import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getDashboardActions } from "../services/api";

const navigationItems = [
  { id: "profile", label: "Profile", shortLabel: "PF", to: "/profile" },
  { id: "dashboard", label: "Dashboard", shortLabel: "DB", to: "/dashboard", end: true },
  { id: "leaderboard", label: "Leaderboard", shortLabel: "LB", to: "/leaderboard" },
  { id: "head-to-head", label: "Head-to-Head", shortLabel: "HH", to: "/head-to-head" },
  { id: "submit-match", label: "Submit Match", shortLabel: "SM", to: "/dashboard/submit-match" },
  { id: "matches", label: "My Matches", shortLabel: "MM", to: "/dashboard/matches" },
  { id: "my-activity", label: "My Activity", shortLabel: "MA", to: "/activity" },
];

const adminNavigationItems = [
  { id: "admin-profile", label: "Admin Profile", shortLabel: "AP", to: "/admin/profile" },
  { id: "admin-dashboard", label: "Admin Dashboard", shortLabel: "AD", to: "/admin/dashboard" },
  { id: "admin-activity", label: "Admin Activity", shortLabel: "AA", to: "/admin/activity" },
  { id: "admin-users", label: "Admin Users", shortLabel: "AU", to: "/admin/users" },
  { id: "admin-settings", label: "Admin Settings", shortLabel: "AS", to: "/admin/settings" },
  { id: "admin-disputes", label: "Admin Disputes", shortLabel: "DI", to: "/admin/disputes" },
];

// Sidebar is the persistent navigation for the player dashboard.
// Keeping navigation here means the dashboard layout can reuse it across future pages.
export default function Sidebar({ isOpen = false, isCollapsed = false, isMobileView = false, onClose }) {
  const { user } = useAuth();
  const location = useLocation();
  const [actionCounts, setActionCounts] = useState({
    total_actions_count: 0,
    disputed_matches_count: 0,
  });
  const isAdminView = location.pathname.startsWith("/admin");
  const visibleNavigationItems =
    user?.role === "admin" || user?.is_admin
      ? [...adminNavigationItems, ...navigationItems]
      : navigationItems;

  function handleNavClick() {
    if (isMobileView) {
      onClose?.();
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadActionCounts() {
      try {
        const response = await getDashboardActions();
        if (isMounted) {
          setActionCounts(response?.data || { total_actions_count: 0, disputed_matches_count: 0 });
        }
      } catch (error) {
        if (isMounted) {
          setActionCounts({ total_actions_count: 0, disputed_matches_count: 0 });
        }
      }
    }

    if (user?.id) {
      loadActionCounts();
    }

    return () => {
      isMounted = false;
    };
  }, [user?.id, user?.role]);

  return (
    <aside
      className={[
        "dashboard-sidebar",
        isOpen ? "dashboard-sidebar-open" : "",
        isCollapsed ? "dashboard-sidebar-collapsed" : "",
        isMobileView ? "dashboard-sidebar-mobile" : "dashboard-sidebar-desktop",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={isMobileView && !isOpen ? "true" : undefined}
    >
      <div className="sidebar-top-row">
        <div className="sidebar-brand">
          <p className="sidebar-eyebrow">{isCollapsed ? "BR" : "BRAGRIGHT"}</p>
          <h2 className="sidebar-title">{isCollapsed ? (isAdminView ? "AD" : "PD") : isAdminView ? "Admin Dashboard" : "Player Dashboard"}</h2>
        </div>

        {isMobileView ? (
          <button
            type="button"
            className="sidebar-close-button"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </div>

      <p className="sidebar-section-label">{isCollapsed ? "Nav" : "Overview"}</p>

      <nav className="sidebar-nav" aria-label="Dashboard navigation">
        {visibleNavigationItems.map((item) => (
          <NavLink
            key={item.id}
            to={item.to}
            end={item.end}
            title={isCollapsed ? item.label : undefined}
            onClick={handleNavClick}
            className={({ isActive }) => {
              const activeClass = isActive ? " sidebar-link-active" : "";

              return `sidebar-link${activeClass}`;
            }}
          >
            <span className="sidebar-link-icon" aria-hidden="true">
              {item.shortLabel}
            </span>
            <span className="sidebar-link-label">{item.label}</span>
            {item.id === "matches" && actionCounts.total_actions_count > 0 ? (
              <span className="sidebar-link-badge">{actionCounts.total_actions_count}</span>
            ) : null}
            {item.id === "admin-disputes" && actionCounts.disputed_matches_count > 0 ? (
              <span className="sidebar-link-badge">{actionCounts.disputed_matches_count}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
