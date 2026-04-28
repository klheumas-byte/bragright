import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton";
import DashboardHeader from "../components/DashboardHeader";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { getApiAssetUrl } from "../services/api";

const DESKTOP_SIDEBAR_STORAGE_KEY = "bragright_sidebar_collapsed";
const MOBILE_BREAKPOINT_QUERY = "(max-width: 900px)";

// DashboardLayout is a layout component for dashboard pages.
// Layout components define shared page structure like sidebars, headers, and content spacing.
export default function DashboardLayout({ title, description, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readStoredSidebarPreference);
  const [isMobileView, setIsMobileView] = useState(() => window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches);
  const isAdminView = location.pathname.startsWith("/admin");
  const avatarInitials = getAvatarInitials(user?.username || user?.email || "BR");
  const identityLabel = user?.username || user?.email || "BragRight Player";
  const identityMeta = user?.email || (isAdminView ? "Admin account" : "Competitive account");
  const avatarImage = user?.profile_image ? getApiAssetUrl(user.profile_image) : "";

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);

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
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.classList.remove("dashboard-mobile-menu-open");
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMobileView, sidebarOpen]);

  useEffect(() => {
    localStorage.setItem(DESKTOP_SIDEBAR_STORAGE_KEY, JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

  function handleSidebarToggle() {
    if (isMobileView) {
      setSidebarOpen((currentValue) => !currentValue);
      return;
    }

    setSidebarCollapsed((currentValue) => !currentValue);
  }

  function handleSidebarClose() {
    setSidebarOpen(false);
  }

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className={`dashboard-shell${sidebarCollapsed && !isMobileView ? " dashboard-shell-sidebar-collapsed" : ""}`}>
      <Sidebar
        isMobileView={isMobileView}
        isOpen={isMobileView ? sidebarOpen : true}
        isCollapsed={!isMobileView && sidebarCollapsed}
        onClose={handleSidebarClose}
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
          isSidebarCollapsed={sidebarCollapsed}
          isMobileView={isMobileView}
        />
        <div className="dashboard-content">
          <div className="dashboard-content-topbar">
            <BackButton />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function getAvatarInitials(value) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function readStoredSidebarPreference() {
  try {
    return JSON.parse(localStorage.getItem(DESKTOP_SIDEBAR_STORAGE_KEY) || "false");
  } catch (error) {
    return false;
  }
}
