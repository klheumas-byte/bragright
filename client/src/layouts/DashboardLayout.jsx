import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton";
import DashboardHeader from "../components/DashboardHeader";
import MobileFastScroll from "../components/MobileFastScroll";
import { RoutePageSkeleton } from "../components/LoadingSkeletons";
import RouteErrorBoundary from "../components/RouteErrorBoundary";
import Sidebar from "../components/Sidebar";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import { getApiAssetUrl } from "../services/api";

const MOBILE_NAVIGATION_QUERY = "(max-width: 900px), (hover: none), (pointer: coarse)";
const DashboardLayoutContext = createContext(null);

const ROUTE_META = {
  "/dashboard": ["Competitive Command Center", "Track your record, ranking, rivals, and next move."],
  "/leaderboard": ["Leaderboard", "See who owns the top spot."],
  "/profile": ["My Profile", "Your competitive identity, record, and match history."],
  "/activity": ["My Activity", "Follow every move in your private competitive journey."],
  "/head-to-head": ["Head-to-Head", "Compare rivals and settle the matchup with real records."],
  "/dashboard/matches": ["My Matches", "Track every challenge, result, and rivalry."],
  "/dashboard/submit-match": ["Challenge Arena", "Challenge a rival and record the result."],
  "/admin/dashboard": ["Admin Dashboard", "Keep BragRight's competitive arena trusted and operational."],
  "/admin/profile": ["Admin Profile", "Your operator identity and recent arena actions."],
  "/admin/activity": ["Admin Activity", "Protected operational events with safe actor and related-record context."],
  "/admin/users": ["Admin Users", "Manage player access without losing sight of the competition."],
  "/admin/disputes": ["Admin Disputes", "Resolve contested results and protect the integrity of play."],
  "/admin/settings": ["Admin Settings", "Tune the rules that keep the competitive experience reliable."],
};

export function DashboardLayoutProvider({ children }) {
  const [pageMeta, setPageMeta] = useState(null);
  const value = useMemo(() => ({ pageMeta, setPageMeta }), [pageMeta]);
  return <DashboardLayoutContext.Provider value={value}>{children}</DashboardLayoutContext.Provider>;
}

export default function DashboardLayout({ title, description, sidebarRank, showBackButton = true, children }) {
  const location = useLocation();
  const context = useContext(DashboardLayoutContext);

  useLayoutEffect(() => {
    context?.setPageMeta({ pathname: location.pathname, title, description, sidebarRank, showBackButton });
  }, [context?.setPageMeta, description, location.pathname, showBackButton, sidebarRank, title]);

  return children;
}

// The shell is mounted once above authenticated route content. Page-level
// DashboardLayout wrappers only publish header metadata and no longer recreate it.
export function DashboardShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { pageMeta } = useContext(DashboardLayoutContext) || {};
  const sidebarToggleRef = useRef(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobileView, setIsMobileView] = useState(readInitialMobileView);
  const isAdminView = location.pathname.startsWith("/admin");
  const identityLabel = user?.username || user?.email || "BragRight Player";
  const identityMeta = user?.email || (isAdminView ? "Admin account" : "Competitive account");
  const avatarImage = user?.profile_image ? getApiAssetUrl(user.profile_image) : "";
  const defaultMeta = getRouteMeta(location.pathname);
  const activeMeta = pageMeta?.pathname === location.pathname ? pageMeta : defaultMeta;
  const { title, description, sidebarRank, showBackButton = true } = activeMeta;

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
          <RouteErrorBoundary resetKey={`${location.pathname}${location.search}`}>
            <Suspense fallback={<RoutePageSkeleton pathname={location.pathname} />}>
              <RouteReadySignal routeKey={`${location.pathname}${location.search}`}>
                <Outlet />
              </RouteReadySignal>
            </Suspense>
          </RouteErrorBoundary>
        </div>
      </main>
      {isMobileView ? <MobileFastScroll /> : null}
    </div>
  );
}

function RouteReadySignal({ routeKey, children }) {
  const { markRouteRendered } = useLoading();

  useEffect(() => {
    const timeoutId = window.setTimeout(markRouteRendered, 0);
    return () => window.clearTimeout(timeoutId);
  }, [markRouteRendered, routeKey]);

  return children;
}

function getRouteMeta(pathname) {
  if (pathname.startsWith("/players/")) {
    return { title: "Player Profile", description: "Review this player's competitive record and rivalry context." };
  }
  if (pathname.startsWith("/head-to-head/")) {
    return { title: ROUTE_META["/head-to-head"][0], description: ROUTE_META["/head-to-head"][1] };
  }
  const [title = "BragRight", description = "Your competitive arena."] = ROUTE_META[pathname] || [];
  return { title, description, showBackButton: pathname !== "/dashboard/matches" };
}

function readInitialMobileView() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(MOBILE_NAVIGATION_QUERY).matches;
}
