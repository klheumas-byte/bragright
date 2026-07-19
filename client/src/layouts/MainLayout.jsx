import { Suspense, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AuthPageSkeleton } from "../components/LoadingSkeletons";
import Navbar from "../components/Navbar";
import RouteErrorBoundary from "../components/RouteErrorBoundary";
import { useLoading } from "../context/LoadingContext";

export default function MainLayout() {
  const location = useLocation();
  return (
    <div className="app-shell">
      <Navbar />

      <main className="page-container">
        <RouteErrorBoundary resetKey={`${location.pathname}${location.search}`}>
          <Suspense fallback={<AuthPageSkeleton />}>
            <PublicRouteReady routeKey={`${location.pathname}${location.search}`}>
              <Outlet />
            </PublicRouteReady>
          </Suspense>
        </RouteErrorBoundary>
      </main>
    </div>
  );
}

function PublicRouteReady({ routeKey, children }) {
  const { markRouteRendered } = useLoading();
  useEffect(() => {
    const timeoutId = window.setTimeout(markRouteRendered, 0);
    return () => window.clearTimeout(timeoutId);
  }, [markRouteRendered, routeKey]);
  return children;
}
