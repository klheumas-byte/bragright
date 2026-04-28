import { Navigate, useLocation } from "react-router-dom";
import { PLAYER_HOME_PATH, useAuth } from "../context/AuthContext";
import SectionSkeleton from "./SectionSkeleton";

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { isAuthenticated, isInitializing, user } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return (
      <section className="route-loading-shell">
        <div className="route-loading-card">
          <p className="route-loading-label">Authenticating</p>
          <h1 className="route-loading-title">Checking your dashboard access</h1>
          <SectionSkeleton lines={3} />
        </div>
      </section>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireAdmin && user?.role !== "admin" && !user?.is_admin) {
    return <Navigate to={PLAYER_HOME_PATH} replace />;
  }

  return children;
}
