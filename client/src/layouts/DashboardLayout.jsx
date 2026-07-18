import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton";
import { getAvatarInitials } from "../components/avatarViewModel";
import DashboardHeader from "../components/DashboardHeader";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { getApiAssetUrl } from "../services/api";

const MOBILE_NAVIGATION_QUERY = "(max-width: 900px), (hover: none), (pointer: coarse)";

// DashboardLayout is a layout component for dashboard pages.
// Layout components define shared page structure like sidebars, headers, and content spacing.
export default function DashboardLayout({ title, description, sidebarRank, showBackButton = true, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const sidebarToggleRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(readInitialMobileView);
  const isAdminView = location.pathname.startsWith("/admin");
  const avatarInitials = getAvatarInitials(user?.username || user?.email || "");
  const identityLabel = user?.username || user?.email || "BragRight Player";
  const identityMeta = user?.email || (isAdminView ? "Admin account" : "Competitive account");
  const avatarImage = user?.profile_image ? getApiAssetUrl(user.profile_image) : "";

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const mediaQuery = window.matchMedia(MOBILE_NAVIGATION_QUERY);

    function handleMediaQueryChange(event) {
      const nextIsMobileView = event.matches;
      setIsMobileView(nextIsMobileView);

      if (!nextIsMobileView) {
        setSidebarOpen(false);
      }
    }

    setIsMobileView(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleMediaQueryChange);
      return () => mediaQuery.removeEventListener("change", handleMediaQueryChange);
    }

    mediaQuery.addListener(handleMediaQueryChange);
    return () => mediaQuery.removeListener(handleMediaQueryChange);
  }, []);

  useEffect(() => {
    document.body.classList.toggle("dashboard-mobile-menu-open", isMobileView && sidebarOpen);

    function handleEscape(event) {
      if (event.key === "Escape" && sidebarOpen) {
        setSidebarOpen(false);
        window.requestAnimationFrame(() => sidebarToggleRef.current?.focus());
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.classList.remove("dashboard-mobile-menu-open");
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileView, sidebarOpen]);

  function handleSidebarToggle() {
    setSidebarOpen((currentValue) => !currentValue);
  }

  const handleSidebarClose = useCallback(() => {
    setSidebarOpen(false);
    if (isMobileView) {
      window.requestAnimationFrame(() => sidebarToggleRef.current?.focus());
    }
  }, [isMobileView]);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="dashboard-shell dashboard-shell-sidebar-collapsed">
      <Sidebar
        isMobileView={isMobileView}
        isOpen={isMobileView ? sidebarOpen : true}
        isCollapsed={!isMobileView}
        currentRank={sidebarRank}
        onClose={handleSidebarClose}
        onLogout={handleLogout}
      />

      {isMobileView && sidebarOpen ? (
        <button
          type="button"
          className="dashboard-sidebar-backdrop"
          aria-label="Close navigation menu"
          onClick={handleSidebarClose}
        />
      ) : null}

      <main className="dashboard-main">
        <DashboardHeader
          label={isAdminView ? "Admin Area" : "Dashboard Area"}
          title={title}
          description={description}
          identityLabel={identityLabel}
          identityMeta={identityMeta}
          avatarInitials={avatarInitials}
          avatarImage={avatarImage}
          onLogout={handleLogout}
          onSidebarToggle={handleSidebarToggle}
          isSidebarOpen={sidebarOpen}
          isMobileView={isMobileView}
          sidebarButtonRef={sidebarToggleRef}
        />
        <div className="dashboard-content">
          {showBackButton ? (
            <div className="dashboard-content-topbar"><BackButton /></div>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}

function readInitialMobileView() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(MOBILE_NAVIGATION_QUERY).matches;
}
