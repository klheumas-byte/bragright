import { memo, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import {
  ADMIN_NAVIGATION_ITEMS,
  PAYMENT_NAVIGATION_ITEMS,
  PLAYER_NAVIGATION_ITEMS,
  RESTRICTED_PLAYER_NAVIGATION_ITEMS,
} from "./sidebarNavigation";

const NAV_EMOJI = {
  dashboard: "🏠",
  matches: "⚔️",
  submit: "➕",
  profile: "👤",
  leaderboard: "🏆",
  compare: "🆚",
  activity: "📋",
  settings: "⚙️",
  adminDashboard: "🛡️",
  users: "👥",
  disputes: "⚖️",
  adminProfile: "🧑‍💼",
};

const MAX_PRIMARY_ITEMS = 4;
const PLAYER_PRIMARY_IDS = ["dashboard", "matches", "submit-match", "leaderboard"];

function pickPrimaryItems(items) {
  if (items === PLAYER_NAVIGATION_ITEMS) {
    return PLAYER_PRIMARY_IDS.map((id) => items.find((item) => item.id === id)).filter(Boolean);
  }
  return items.slice(0, MAX_PRIMARY_ITEMS);
}

// TikTok-style bottom tab bar for mobile/tablet. Desktop keeps the Sidebar rail.
// "More" reopens the existing Sidebar, now presented as a bottom sheet, for everything else.
function MobileBottomNav({ isMoreOpen = false, onMoreClick, moreButtonRef }) {
  const { user } = useAuth();
  const location = useLocation();
  const isAdminView = location.pathname.startsWith("/admin");

  const visibleNavigationItems = useMemo(() => {
    if (user?.role === "payment_officer") return PAYMENT_NAVIGATION_ITEMS;
    if (user?.role === "player" && user?.subscription_access === false) {
      return RESTRICTED_PLAYER_NAVIGATION_ITEMS;
    }
    const isAdmin = user?.role === "admin" || user?.role === "super_admin" || user?.is_admin;
    if (!isAdmin) return PLAYER_NAVIGATION_ITEMS;
    return isAdminView ? ADMIN_NAVIGATION_ITEMS : [ADMIN_NAVIGATION_ITEMS[0], ...PLAYER_NAVIGATION_ITEMS];
  }, [isAdminView, user?.is_admin, user?.role, user?.subscription_access]);

  const primaryItems = pickPrimaryItems(visibleNavigationItems);
  const hasMore = visibleNavigationItems.length > primaryItems.length;

  return (
    <nav className="mobile-bottom-nav" aria-label="Primary navigation">
      {primaryItems.map((item) => (
        <NavLink
          key={item.id}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `mobile-bottom-nav-link${isActive ? " mobile-bottom-nav-link-active" : ""}`
          }
        >
          <span className="mobile-bottom-nav-emoji" aria-hidden="true">
            {NAV_EMOJI[item.icon] || "🔘"}
          </span>
          <span className="mobile-bottom-nav-label">{item.label}</span>
        </NavLink>
      ))}

      {hasMore ? (
        <button
          ref={moreButtonRef}
          type="button"
          className={`mobile-bottom-nav-link mobile-bottom-nav-more${isMoreOpen ? " mobile-bottom-nav-link-active" : ""}`}
          aria-expanded={isMoreOpen}
          aria-haspopup="dialog"
          aria-controls="dashboard-sidebar-sheet"
          onClick={onMoreClick}
        >
          <span className="mobile-bottom-nav-emoji" aria-hidden="true">☰</span>
          <span className="mobile-bottom-nav-label">More</span>
        </button>
      ) : null}
    </nav>
  );
}

export default memo(MobileBottomNav);
