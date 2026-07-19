import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getDashboardActions } from "../services/api";
import ProfileAvatar from "./ProfileAvatar";
import SidebarIcon from "./SidebarIcon";
import {
  ADMIN_NAVIGATION_ITEMS,
  PLAYER_NAVIGATION_ITEMS,
} from "./sidebarNavigation";
import { getSidebarIdentity } from "./sidebarViewModel";

const SIDEBAR_SCROLL_STORAGE_KEY = "bragright_sidebar_scroll";

function Sidebar({
  isOpen = false,
  isCollapsed = false,
  isMobileView = false,
  currentRank,
  onClose,
  onLogout,
}) {
  const { user } = useAuth();
  const location = useLocation();
  const sidebarRef = useRef(null);
  const navigationRef = useRef(null);
  const closeButtonRef = useRef(null);
  const [actionCounts, setActionCounts] = useState({
    total_actions_count: 0,
    disputed_matches_count: 0,
  });
  const isAdminView = location.pathname.startsWith("/admin");
  const visibleNavigationItems = useMemo(
    () =>
      user?.role === "admin" || user?.is_admin
        ? [...ADMIN_NAVIGATION_ITEMS, ...PLAYER_NAVIGATION_ITEMS]
        : PLAYER_NAVIGATION_ITEMS,
    [user?.is_admin, user?.role]
  );
  const identity = useMemo(() => getSidebarIdentity(user), [
    user?.display_name,
    user?.email,
    user?.profile_image,
    user?.username,
  ]);

  const handleNavClick = useCallback(() => {
    if (isMobileView) {
      onClose?.();
    }
  }, [isMobileView, onClose]);

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

  useEffect(() => {
    if (!navigationRef.current) {
      return;
    }
    try {
      navigationRef.current.scrollTop = Number(sessionStorage.getItem(SIDEBAR_SCROLL_STORAGE_KEY)) || 0;
    } catch (error) {
      return;
    }
  }, []);

  useEffect(() => {
    if (isMobileView && isOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isMobileView, isOpen]);

  function preserveScrollPosition() {
    try {
      sessionStorage.setItem(
        SIDEBAR_SCROLL_STORAGE_KEY,
        String(navigationRef.current?.scrollTop || 0)
      );
    } catch (error) {
      return;
    }
  }

  function handleSidebarKeyDown(event) {
    if (!isMobileView || !isOpen || event.key !== "Tab") {
      return;
    }
    const focusableElements = Array.from(
      sidebarRef.current?.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) || []
    );
    if (!focusableElements.length) {
      return;
    }
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  return (
    <aside
      ref={sidebarRef}
      className={[
        "dashboard-sidebar",
        isOpen ? "dashboard-sidebar-open" : "",
        isCollapsed ? "dashboard-sidebar-collapsed" : "",
        isMobileView ? "dashboard-sidebar-mobile" : "dashboard-sidebar-desktop",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={isMobileView && !isOpen ? "true" : undefined}
      aria-label="BragRight navigation"
      aria-modal={isMobileView && isOpen ? "true" : undefined}
      inert={isMobileView && !isOpen ? "" : undefined}
      role={isMobileView ? "dialog" : undefined}
      onKeyDown={handleSidebarKeyDown}
    >
      <div className="sidebar-top-row">
        <div className="sidebar-brand">
          <p className="sidebar-eyebrow"><span className="sidebar-brand-mark">BR</span><span className="sidebar-expanded-copy">BRAGRIGHT</span></p>
          <h2 className="sidebar-title sidebar-expanded-copy">{isAdminView ? "Admin Arena" : "Player Arena"}</h2>
        </div>

        {isMobileView ? (
          <button
            ref={closeButtonRef}
            type="button"
            className="sidebar-close-button"
            aria-label="Close navigation menu"
            onClick={onClose}
          >
            Close
          </button>
        ) : null}
      </div>

      <SidebarUserBlock identity={identity} currentRank={currentRank} isCollapsed={isCollapsed} isAdminView={isAdminView} onClick={handleNavClick} />

      <nav ref={navigationRef} className="sidebar-nav" aria-label="Primary navigation" onScroll={preserveScrollPosition}>
        <p className="sidebar-section-label"><span className="sidebar-collapsed-copy">Nav</span><span className="sidebar-expanded-copy">Command deck</span></p>
        {visibleNavigationItems.map((item) => (
          <SidebarNavigationItem
            key={item.id}
            item={item}
            identity={identity}
            isCollapsed={isCollapsed}
            badge={
              item.id === "matches"
                ? actionCounts.total_actions_count
                : item.id === "admin-disputes"
                  ? actionCounts.disputed_matches_count
                  : 0
            }
            onClick={handleNavClick}
          />
        ))}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="sidebar-logout" onClick={onLogout} title={isCollapsed ? "Log out" : undefined}>
          <span className="sidebar-link-icon"><SidebarIcon name="logout" decorative /></span>
          <span className="sidebar-link-label">Log out</span>
          <span className="sidebar-tooltip" role="tooltip">Log out</span>
        </button>
      </div>
    </aside>
  );
}

const SidebarNavigationItem = memo(function SidebarNavigationItem({
  item,
  identity,
  isCollapsed,
  badge,
  onClick,
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={isCollapsed ? item.label : undefined}
      aria-label={isCollapsed ? item.label : undefined}
      onClick={onClick}
      className={({ isActive }) => `sidebar-link${isActive ? " sidebar-link-active" : ""}`}
    >
      <span className="sidebar-link-icon">
        {item.id === "profile" ? (
          <SidebarAvatar identity={identity} compact />
        ) : (
          <SidebarIcon name={item.icon} decorative />
        )}
      </span>
      <span className="sidebar-link-label">{item.label}</span>
      <span className="sidebar-tooltip" role="tooltip">{item.label}</span>
      {badge > 0 ? (
        <span className="sidebar-link-badge" aria-label={`${badge} pending actions`}>
          {badge}
        </span>
      ) : null}
    </NavLink>
  );
});

const SidebarUserBlock = memo(function SidebarUserBlock({ identity, currentRank, isCollapsed, isAdminView, onClick }) {
  return (
    <NavLink
      to={isAdminView ? "/admin/profile" : "/profile"}
      className="sidebar-user-block"
      aria-label={`${identity.displayName}, signed-in user`}
      title={isCollapsed ? identity.displayName : undefined}
      onClick={onClick}
    >
      <SidebarAvatar identity={identity} />
      <div className="sidebar-user-copy">
        <strong>{identity.displayName}</strong>
        {identity.username ? <span>@{identity.username}</span> : null}
        <div className="sidebar-user-context">
          {currentRank ? (
            <span className="sidebar-user-rank" aria-label={`Current rank: ${currentRank}`}>
              <SidebarIcon name="crown" decorative /> Rank #{currentRank}
            </span>
          ) : null}
          <span className="sidebar-session-status">
            <span className="sidebar-session-dot" aria-hidden="true" />
            Session active
          </span>
        </div>
      </div>
      <span className="sidebar-tooltip" role="tooltip">{identity.displayName}</span>
    </NavLink>
  );
});

function SidebarAvatar({ identity, compact = false }) {
  return (
    <ProfileAvatar
      image={identity.image}
      name={identity.initials ? identity.displayName : ""}
      size={compact ? "xs" : "sm"}
      className={`sidebar-avatar${compact ? " sidebar-avatar-compact" : ""}`}
    />
  );
}

export default memo(Sidebar);
